#include "ui/ShareTradeDialog.h"
#include "ui/Theme.h"
#include "ui/Toast.h"
#include "core/ApiClient.h"

#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QGridLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QRadioButton>
#include <QButtonGroup>
#include <QGroupBox>
#include <QPainter>
#include <QPainterPath>
#include <QLinearGradient>
#include <QRadialGradient>
#include <QFileDialog>
#include <QMessageBox>
#include <QClipboard>
#include <QGuiApplication>
#include <QDateTime>
#include <QStandardPaths>
#include <QDir>
#include <QUrl>
#include <QRegularExpression>
#include <cmath>

namespace {

// The card's own palette. Deliberately fixed rather than themed: it is
// artwork that leaves the terminal and gets posted somewhere else, and a
// screenshot that changes colour with the trader's light/dark preference is
// not a brand asset.
const QColor kUp      ("#10b981");
const QColor kDown    ("#ef4444");
const QColor kInk     ("#ffffff");

QString fmtStamp(const QString& iso) {
    if (iso.isEmpty()) return QStringLiteral("—");
    QDateTime t = QDateTime::fromString(iso, Qt::ISODateWithMs);
    if (!t.isValid()) t = QDateTime::fromString(iso, Qt::ISODate);
    if (!t.isValid()) return iso;
    return t.toLocalTime().toString(QStringLiteral("yyyy/MM/dd HH:mm:ss"));
}

} // namespace

// api.vxness.in serves the API; the share page is a route on the TRADER
// frontend, which is a different host — https://vxness.in, the apex domain.
//
// So the mapping DROPS the api. label rather than swapping it for trade.,
// which is how the broker this code was merged from laid its deployment out.
// That spelling produced trade.vxness.in here, a host that does not resolve,
// and every share link a trader minted led nowhere. A wrong guess is invisible
// until someone opens the link, so keep this in step with wherever the trader
// frontend is actually served.
//
// A local gateway maps to the local frontend's port instead of silently
// pointing at production.
QString ShareTradeDialog::shareSiteFor(const QString& restBase) {
    const QUrl u(restBase);
    QString host = u.host();
    if (host.isEmpty()) return QStringLiteral("https://vxness.in");

    if (host == "localhost" || host == "127.0.0.1")
        return QStringLiteral("http://%1:3010").arg(host);

    if (host.startsWith("api."))
        host = host.mid(4);
    return QStringLiteral("https://%1").arg(host);
}

ShareTradeDialog::ShareTradeDialog(const OpenPosition& position, const SymbolSpec& spec,
                                   int leverage, ApiClient* api, const QString& restBase,
                                   QWidget* parent)
    : QDialog(parent), m_pos(position), m_spec(spec),
      m_leverage(leverage > 0 ? leverage : 100), m_api(api),
      m_site(shareSiteFor(restBase)) {
    setWindowTitle(tr("Share trade"));
    setModal(true);

    const auto& c = Theme::p();

    // ── left: the card ──
    m_preview = new QLabel;
    m_preview->setFixedSize(340, 425);          // 4:5
    m_preview->setAlignment(Qt::AlignCenter);

    // ── right: what the card says ──
    auto cap = [&](const QString& t) {
        auto* l = new QLabel(t);
        l->setStyleSheet(QString("color:%1; font-size:10px; font-weight:800;"
                                 "letter-spacing:1px;").arg(c.muted));
        return l;
    };
    auto note = [&](const QString& t) {
        auto* l = new QLabel(t);
        l->setWordWrap(true);
        l->setStyleSheet(QString("color:%1; font-size:11px;").arg(c.muted));
        return l;
    };

    // What to share. Only the single trade is offered, because that is what
    // the platform's share endpoint mints — it takes a position id. The other
    // two the web mockup shows would each need their own server-side link, and
    // a radio that cannot work is worse than one that is not there.
    auto* whatBox = new QGroupBox(tr("What to share"));
    whatBox->setStyleSheet(QString("QGroupBox{color:%1; font-weight:700; border:1px solid %2;"
                                   "border-radius:8px; margin-top:8px; padding:10px 10px 8px;}"
                                   "QGroupBox::title{subcontrol-origin:margin; left:10px;}")
                           .arg(c.textStrong, c.border));
    auto* whatLay = new QVBoxLayout(whatBox);
    auto* thisTrade = new QRadioButton(tr("This trade only"));
    thisTrade->setChecked(true);
    thisTrade->setStyleSheet(QString("color:%1;").arg(c.textStrong));
    whatLay->addWidget(thisTrade);
    whatLay->addWidget(note(tr("%1 · %2 lots")
                           .arg(m_pos.symbol, QString::number(m_pos.lots, 'f', 2))));

    auto* descCap = new QHBoxLayout;
    m_descCount = new QLabel;
    m_descCount->setStyleSheet(QString("color:%1; font-size:10px;").arg(c.dim));
    descCap->addWidget(cap(tr("CARD DESCRIPTION")));
    descCap->addStretch();
    descCap->addWidget(m_descCount);

    m_desc = new QPlainTextEdit;
    m_desc->setPlaceholderText(tr("Describe your trade"));
    m_desc->setFixedHeight(56);

    auto* linkCap = new QHBoxLayout;
    m_linkCount = new QLabel;
    m_linkCount->setStyleSheet(QString("color:%1; font-size:10px;").arg(c.dim));
    linkCap->addWidget(cap(tr("ONLINE LINK DESCRIPTION")));
    linkCap->addStretch();
    linkCap->addWidget(m_linkCount);

    m_linkDesc = new QPlainTextEdit;
    m_linkDesc->setPlaceholderText(tr("Share your links, e.g. https://www.instagram.com/…"));
    m_linkDesc->setFixedHeight(56);

    const QString editCss = QString(
        "QPlainTextEdit{background:%1; border:1px solid %2; border-radius:6px;"
        "padding:4px 6px; color:%3;}"
        "QPlainTextEdit:focus{border:1px solid %4;}")
        .arg(c.inputBg, c.inputBorder, c.textStrong, c.accent);
    m_desc->setStyleSheet(editCss);
    m_linkDesc->setStyleSheet(editCss);

    // Enforced here as well as on the server, so the count never shows a
    // number the platform would reject.
    auto limit = [this](QPlainTextEdit* e, QLabel* counter, int max) {
        connect(e, &QPlainTextEdit::textChanged, this, [this, e, counter, max]() {
            QString t = e->toPlainText();
            if (t.size() > max) {
                const QSignalBlocker block(e);
                t.truncate(max);
                e->setPlainText(t);
                e->moveCursor(QTextCursor::End);
            }
            counter->setText(QStringLiteral("%1/%2").arg(t.size()).arg(max));
            refreshCard();
        });
        counter->setText(QStringLiteral("0/%1").arg(max));
    };
    limit(m_desc,     m_descCount, 140);
    limit(m_linkDesc, m_linkCount, 500);

    // Which figure the card leads with. The three the platform accepts.
    auto* modeBox = new QGroupBox(tr("Profit / Loss"));
    modeBox->setStyleSheet(whatBox->styleSheet());
    auto* modeLay = new QVBoxLayout(modeBox);
    m_modePnl   = new QRadioButton(tr("Profit and loss"));
    m_modeRoi   = new QRadioButton(tr("ROI % compared to margin"));
    m_modeTicks = new QRadioButton(tr("Ticks"));
    m_modePnl->setChecked(true);
    for (QRadioButton* b : {m_modePnl, m_modeRoi, m_modeTicks}) {
        b->setStyleSheet(QString("color:%1;").arg(c.textStrong));
        modeLay->addWidget(b);
        // The card redraws on every switch, and the link carries the mode, so
        // a link minted before the change is updated by pressing the button
        // again — the server reuses it.
        connect(b, &QRadioButton::toggled, this, &ShareTradeDialog::refreshCard);
    }

    m_urlBox = new QLineEdit;
    m_urlBox->setReadOnly(true);
    m_urlBox->setPlaceholderText(tr("The link appears here once created"));
    m_urlBox->setStyleSheet(QString(
        "QLineEdit{background:%1; border:1px solid %2; border-radius:6px;"
        "padding:5px 8px; color:%3; font-family:Consolas,monospace;}")
        .arg(c.inputBg, c.inputBorder, c.textStrong));

    m_status = new QLabel;
    m_status->setWordWrap(true);
    m_status->setStyleSheet(QString("color:%1; font-size:11px;").arg(c.muted));

    m_createBtn = new QPushButton(tr("Create link"));
    m_createBtn->setMinimumHeight(38);
    m_createBtn->setCursor(Qt::PointingHandCursor);
    m_createBtn->setStyleSheet(QString(
        "QPushButton{background:%1; color:#ffffff; border:none; border-radius:8px;"
        "font-weight:800;}"
        "QPushButton:hover{background:%2;}"
        "QPushButton:disabled{background:%3; color:%4;}")
        .arg(c.accent, c.accentHover, c.btnBg, c.dim));
    connect(m_createBtn, &QPushButton::clicked, this, &ShareTradeDialog::createLink);

    m_downloadBtn = new QPushButton(tr("Download"));
    m_downloadBtn->setMinimumHeight(38);
    m_downloadBtn->setCursor(Qt::PointingHandCursor);
    m_downloadBtn->setStyleSheet(QString(
        "QPushButton{background:%1; color:%2; border:1px solid %3; border-radius:8px;"
        "font-weight:700;}"
        "QPushButton:hover{border-color:%4; color:%4;}")
        .arg(c.btnBg, c.textStrong, c.btnBorder, c.accent));
    connect(m_downloadBtn, &QPushButton::clicked, this, &ShareTradeDialog::downloadCard);

    auto* actions = new QHBoxLayout;
    actions->setSpacing(8);
    actions->addWidget(m_createBtn, 1);
    actions->addWidget(m_downloadBtn, 1);

    auto* right = new QVBoxLayout;
    right->setSpacing(8);
    right->addWidget(whatBox);
    right->addLayout(descCap);
    right->addWidget(m_desc);
    right->addLayout(linkCap);
    right->addWidget(m_linkDesc);
    right->addWidget(note(tr("Text is shown only when the shared link is visited. "
                             "Put your affiliate or social links here.")));
    right->addWidget(modeBox);
    right->addWidget(m_urlBox);
    right->addWidget(m_status);
    right->addStretch(1);
    right->addLayout(actions);

    auto* lay = new QHBoxLayout(this);
    lay->setSpacing(16);
    lay->addWidget(m_preview, 0, Qt::AlignTop);
    lay->addLayout(right, 1);

    if (m_api)
        connect(m_api, &ApiClient::shareLinkCreated, this,
                [this](bool ok, const QString& code) {
            m_createBtn->setEnabled(true);
            m_createBtn->setText(tr("Create link"));
            if (!ok) {
                m_status->setText(tr("Could not create the link: %1").arg(code));
                m_status->setStyleSheet(QString("color:%1; font-size:11px;")
                                        .arg(Theme::p().down));
                return;
            }
            m_code = code;
            const QString url = m_site + "/s/" + code;
            m_urlBox->setText(url);
            QGuiApplication::clipboard()->setText(url);
            m_status->setText(tr("Link copied to the clipboard."));
            m_status->setStyleSheet(QString("color:%1; font-size:11px;")
                                    .arg(Theme::p().muted));
            refreshCard();          // the card carries the real URL now
            Toast::success(this, tr("Link created"), url);
        });

    refreshCard();
}

QString ShareTradeDialog::displayMode() const {
    if (m_modeRoi && m_modeRoi->isChecked())   return QStringLiteral("roi");
    if (m_modeTicks && m_modeTicks->isChecked()) return QStringLiteral("ticks");
    return QStringLiteral("pnl");
}

// The headline, in the selected unit. ROI is measured against the margin the
// position actually ties up, which is what the trader is risking — a percentage
// of the notional would flatter every leveraged trade.
QString ShareTradeDialog::headline() const {
    const double pnl = m_pos.profit;
    const QString mode = displayMode();

    if (mode == "ticks") {
        const double pip = m_spec.digits > 0 ? std::pow(10.0, -m_spec.digits + 1) : 0.0001;
        const bool buy = m_pos.side.compare("buy", Qt::CaseInsensitive) == 0;
        const double move = buy ? (m_pos.currentPrice - m_pos.openPrice)
                                : (m_pos.openPrice - m_pos.currentPrice);
        const double ticks = pip > 0 ? move / pip : 0.0;
        return QStringLiteral("%1%2 ticks")
            .arg(ticks >= 0 ? "+" : "-", QString::number(std::fabs(ticks), 'f', 1));
    }
    if (mode == "roi") {
        const double contract = m_spec.contractSize > 0 ? m_spec.contractSize : 100000.0;
        const double margin = m_leverage > 0
            ? (m_pos.lots * contract * m_pos.openPrice) / m_leverage : 0.0;
        const double roi = margin > 0 ? (pnl / margin) * 100.0 : 0.0;
        return QStringLiteral("%1%2%")
            .arg(roi >= 0 ? "+" : "-", QString::number(std::fabs(roi), 'f', 2));
    }
    return QStringLiteral("%1$%2")
        .arg(pnl >= 0 ? "+" : "-", QString::number(std::fabs(pnl), 'f', 2));
}

void ShareTradeDialog::refreshCard() {
    m_preview->setPixmap(renderCard(m_preview->width()));
}

// Everything is expressed as a fraction of the width, so the same code draws
// the 340px preview and the 1080px export.
QPixmap ShareTradeDialog::renderCard(int width) const {
    const int W = width;
    const int H = int(width * 1.25);            // 4:5
    const double k = W / 340.0;                 // scale against the design size

    QPixmap pm(W, H);
    pm.fill(Qt::transparent);
    QPainter p(&pm);
    p.setRenderHint(QPainter::Antialiasing);
    p.setRenderHint(QPainter::SmoothPixmapTransform);
    p.setRenderHint(QPainter::TextAntialiasing);

    const int radius = int(16 * k);
    QPainterPath clip;
    clip.addRoundedRect(QRectF(0, 0, W, H), radius, radius);
    p.setClipPath(clip);

    // Deep blue glow at the top fading to black — the web card's radial
    // gradient, which reads as "night sky" behind the star field.
    QRadialGradient glow(QPointF(W * 0.5, 0), W * 1.15);
    glow.setColorAt(0.0,  QColor(30, 64, 175, 200));
    glow.setColorAt(0.45, QColor(8, 10, 24, 245));
    glow.setColorAt(1.0,  QColor(0, 0, 0));
    p.fillPath(clip, glow);

    // Star field. Fixed positions rather than random: the export must match
    // the preview the trader approved, and a card that reshuffles on every
    // redraw looks broken.
    static const double stars[][3] = {
        {0.20, 0.13, 1.3}, {0.70, 0.09, 1.0}, {0.41, 0.31, 1.2}, {0.86, 0.23, 1.0},
        {0.15, 0.38, 1.0}, {0.61, 0.41, 1.4}, {0.31, 0.55, 1.0}, {0.79, 0.60, 1.2},
        {0.11, 0.66, 1.0}, {0.50, 0.72, 1.1}, {0.90, 0.78, 1.0}, {0.25, 0.83, 1.2},
        {0.66, 0.88, 1.0}, {0.44, 0.94, 1.0},
    };
    p.setPen(Qt::NoPen);
    p.setBrush(QColor(255, 255, 255, 110));
    for (const auto& s : stars)
        p.drawEllipse(QPointF(W * s[0], H * s[1]), s[2] * k, s[2] * k);

    // Corner brackets — the "viewfinder" framing.
    const int inset = int(18 * k), arm = int(22 * k);
    QPen bracket(QColor(255, 255, 255, 110), qMax(1.0, 2 * k));
    p.setPen(bracket);
    p.drawLine(inset, inset, inset + arm, inset);
    p.drawLine(inset, inset, inset, inset + arm);
    p.drawLine(W - inset, inset, W - inset - arm, inset);
    p.drawLine(W - inset, inset, W - inset, inset + arm);
    p.drawLine(inset, H - inset, inset + arm, H - inset);
    p.drawLine(inset, H - inset, inset, H - inset - arm);
    p.drawLine(W - inset, H - inset, W - inset - arm, H - inset);
    p.drawLine(W - inset, H - inset, W - inset, H - inset - arm);

    auto font = [&](double px, int weight, double spacing = 0.0) {
        QFont f;
        f.setPixelSize(qMax(1, int(px * k)));
        f.setWeight(QFont::Weight(weight));
        if (spacing > 0) {
            f.setLetterSpacing(QFont::AbsoluteSpacing, spacing * k);
        }
        return f;
    };

    // ── brand: the mark over the wordmark ──
    const QPixmap mark(QStringLiteral(":/vxness-mark-light.png"));
    const int markPx = int(40 * k);
    if (!mark.isNull()) {
        p.drawPixmap(QRect((W - markPx) / 2, int(26 * k), markPx, markPx),
                     mark.scaled(markPx, markPx, Qt::KeepAspectRatio,
                                 Qt::SmoothTransformation));
    }
    p.setPen(kInk);
    p.setFont(font(11, QFont::Black, 3.4));
    p.drawText(QRect(0, int(72 * k), W, int(18 * k)), Qt::AlignCenter,
               QStringLiteral("VXNESS"));

    // ── status + headline ──
    p.setPen(QColor(255, 255, 255, 180));
    p.setFont(font(11, QFont::DemiBold, 1.6));
    p.drawText(QRect(0, int(126 * k), W, int(16 * k)), Qt::AlignCenter,
               tr("ACTIVE TRADE").toUpper());

    const bool positive = m_pos.profit >= 0;
    p.setPen(positive ? kUp : kDown);
    p.setFont(font(42, QFont::Black));
    p.drawText(QRect(0, int(150 * k), W, int(56 * k)),
               Qt::AlignCenter, headline());

    // ── pills: side, lots, symbol, leverage ──
    const bool buy = m_pos.side.compare("buy", Qt::CaseInsensitive) == 0;
    const QString sideText = m_pos.side.toUpper();
    const QString lotsText = tr("%1 lots").arg(QString::number(m_pos.lots, 'f', 2));
    const QString levText  = QStringLiteral("x%1").arg(m_leverage);

    QFont pillFont = font(11, QFont::Black);
    QFont plainFont = font(11, QFont::Bold);
    QFontMetrics pfm(pillFont), plm(plainFont);
    const int padX = int(9 * k), gap = int(7 * k), pillH = int(20 * k);
    const int wSide = pfm.horizontalAdvance(sideText) + padX * 2;
    const int wSym  = pfm.horizontalAdvance(m_pos.symbol) + padX * 2;
    const int wLots = plm.horizontalAdvance(lotsText);
    const int wLev  = plm.horizontalAdvance(levText);
    int x = (W - (wSide + gap + wLots + gap + wSym + gap + wLev)) / 2;
    const int pillY = int(216 * k);

    auto pill = [&](int w, const QColor& fill, const QColor& border, const QColor& text,
                    const QString& label) {
        const QRect r(x, pillY, w, pillH);
        p.setPen(QPen(border, qMax(1.0, 1 * k)));
        p.setBrush(fill);
        p.drawRoundedRect(r, 5 * k, 5 * k);
        p.setPen(text);
        p.setFont(pillFont);
        p.drawText(r, Qt::AlignCenter, label);
        x += w + gap;
    };

    pill(wSide,
         buy ? QColor(16, 185, 129, 45) : QColor(239, 68, 68, 45),
         buy ? QColor(16, 185, 129, 110) : QColor(239, 68, 68, 110),
         buy ? kUp : kDown, sideText);

    p.setPen(kInk);
    p.setFont(plainFont);
    p.drawText(QRect(x, pillY, wLots, pillH), Qt::AlignCenter, lotsText);
    x += wLots + gap;

    pill(wSym, QColor(255, 255, 255, 26), QColor(255, 255, 255, 50), kInk, m_pos.symbol);

    p.setPen(QColor(255, 255, 255, 205));
    p.setFont(plainFont);
    p.drawText(QRect(x, pillY, wLev, pillH), Qt::AlignCenter, levText);

    // ── the trader's own caption ──
    if (!m_desc->toPlainText().trimmed().isEmpty()) {
        p.setPen(QColor(255, 255, 255, 200));
        p.setFont(font(11, QFont::Normal));
        p.drawText(QRect(int(26 * k), int(248 * k), W - int(52 * k), int(40 * k)),
                   Qt::AlignHCenter | Qt::AlignTop | Qt::TextWordWrap,
                   m_desc->toPlainText().trimmed());
    }

    // ── the link ──
    p.setPen(QColor(255, 255, 255, 160));
    QFont mono = font(10, QFont::Normal);
    mono.setFamily(QStringLiteral("Consolas"));
    mono.setStyleHint(QFont::Monospace);
    p.setFont(mono);
    QString shown = m_code.isEmpty()
        ? m_site + "/s/xxxxxx"
        : m_site + "/s/" + m_code;
    shown.remove(QRegularExpression(QStringLiteral("^https?://")));
    p.drawText(QRect(0, int(300 * k), W, int(16 * k)), Qt::AlignCenter, shown);

    // ── open → now ──
    const int digits = m_spec.digits > 0 ? m_spec.digits : 5;
    const int lineY = int(326 * k);
    p.setPen(QPen(QColor(255, 255, 255, 40), qMax(1.0, 1 * k)));
    p.drawLine(int(26 * k), lineY, W - int(26 * k), lineY);

    auto leg = [&](const QRect& box, const QString& title, const QString& stamp) {
        p.setPen(kInk);
        p.setFont(font(11, QFont::Black));
        p.drawText(box, Qt::AlignHCenter | Qt::AlignTop, title);
        p.setPen(QColor(255, 255, 255, 150));
        p.setFont(font(9, QFont::Normal));
        p.drawText(box.adjusted(0, int(16 * k), 0, 0),
                   Qt::AlignHCenter | Qt::AlignTop, stamp);
    };

    const int legW = int(W * 0.42);
    leg(QRect(int(10 * k), lineY + int(12 * k), legW, int(40 * k)),
        tr("OPEN @%1").arg(QString::number(m_pos.openPrice, 'f', digits)),
        fmtStamp(m_pos.openedAt));
    leg(QRect(W - legW - int(10 * k), lineY + int(12 * k), legW, int(40 * k)),
        tr("NOW @%1").arg(QString::number(m_pos.currentPrice, 'f', digits)),
        QDateTime::currentDateTime().toString(QStringLiteral("yyyy/MM/dd HH:mm:ss")));

    // The arrow between them.
    p.setPen(QPen(QColor(255, 255, 255, 110), qMax(1.0, 1.6 * k)));
    const int ax = W / 2, ay = lineY + int(24 * k), aw = int(7 * k);
    p.drawLine(ax - aw, ay, ax + aw, ay);
    p.drawLine(ax + aw, ay, ax + aw - int(4 * k), ay - int(4 * k));
    p.drawLine(ax + aw, ay, ax + aw - int(4 * k), ay + int(4 * k));

    p.end();
    return pm;
}

void ShareTradeDialog::createLink() {
    if (!m_api) return;
    m_createBtn->setEnabled(false);
    m_createBtn->setText(tr("Creating…"));
    m_status->setText(QString());
    m_api->createShareLink(m_pos.id, m_desc->toPlainText().trimmed(),
                           m_linkDesc->toPlainText().trimmed(), displayMode());
}

void ShareTradeDialog::downloadCard() {
    QString dir = QStandardPaths::writableLocation(QStandardPaths::PicturesLocation);
    if (dir.isEmpty()) dir = QDir::homePath();
    const QString suggested = QStringLiteral("%1/vxness-%2-%3.png")
        .arg(dir, m_pos.symbol.toLower(), m_pos.side.toLower());

    const QString path = QFileDialog::getSaveFileName(
        this, tr("Save card"), suggested, tr("PNG image (*.png)"));
    if (path.isEmpty()) return;

    // Exported at three times the preview so it stays sharp when posted —
    // the same drawing, not an upscale of the preview pixmap.
    if (!renderCard(m_preview->width() * 3).save(path, "PNG")) {
        QMessageBox::warning(this, tr("Save card"), tr("Could not write %1").arg(path));
        return;
    }
    m_status->setText(tr("Card saved to %1").arg(QDir::toNativeSeparators(path)));
    Toast::success(this, tr("Card saved"), QDir::toNativeSeparators(path));
}
