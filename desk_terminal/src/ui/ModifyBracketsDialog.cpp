#include "ui/ModifyBracketsDialog.h"
#include "ui/Theme.h"
#include "ui/SpinInput.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QGridLayout>
#include <QLabel>
#include <QDoubleSpinBox>
#include <QPushButton>
#include <QFrame>
#include <QMouseEvent>
#include <QGraphicsDropShadowEffect>
#include <cmath>

ModifyBracketsDialog::ModifyBracketsDialog(const OpenPosition& pos, int digits, QWidget* parent)
    : QDialog(parent), m_pos(pos), m_digits(digits > 0 ? digits : 5),
      m_slWas(pos.sl), m_tpWas(pos.tp) {
    setWindowTitle(tr("Modify S/L and T/P"));
    setModal(true);

    // Frameless, so the card can be rounded and carry its own header. The
    // translucent background is what lets the corners actually be round rather
    // than sitting on a square grey plate.
    setWindowFlags(Qt::Dialog | Qt::FramelessWindowHint);
    setAttribute(Qt::WA_TranslucentBackground);

    const auto& c = Theme::p();
    const bool sell = m_pos.side.compare("sell", Qt::CaseInsensitive) == 0;
    const QString sideColour = sell ? c.down : c.up;

    // ── the card everything lives on ──
    auto* card = new QFrame(this);
    card->setObjectName(QStringLiteral("bracketCard"));
    card->setStyleSheet(QString("QFrame#bracketCard{background:%1; border:1px solid %2;"
                                "border-radius:14px;}")
                        .arg(c.panel, c.border));
    // A soft shadow instead of a window frame — it is what separates the card
    // from the chart behind it now that the OS chrome is gone.
    auto* shadow = new QGraphicsDropShadowEffect(this);
    shadow->setBlurRadius(38);
    shadow->setOffset(0, 10);
    shadow->setColor(QColor(0, 0, 0, Theme::isDark() ? 190 : 70));
    card->setGraphicsEffect(shadow);

    // ── header: what this does, and which position it does it to ──
    auto* title = new QLabel(tr("Modify S/L and T/P"));
    title->setStyleSheet(QString("background:transparent; border:none;"
                                 "font-size:17px; font-weight:800; color:%1;")
                         .arg(c.textStrong));

    auto* subtitle = new QLabel(tr("Set a level, or clear a box to remove that bracket."));
    subtitle->setStyleSheet(QString("background:transparent; border:none;"
                                    "font-size:11px; color:%1;").arg(c.muted));

    auto* sidePill = new QLabel(QStringLiteral("%1  ·  %2")
                                    .arg(m_pos.symbol, m_pos.side.toUpper()));
    sidePill->setStyleSheet(QString(
        "background:%1; color:%2; border:1px solid %2; border-radius:12px;"
        "padding:4px 12px; font-size:11px; font-weight:800;")
        .arg(sell ? QStringLiteral("rgba(224,27,36,0.12)")
                  : QStringLiteral("rgba(38,162,105,0.12)"),
             sideColour));

    auto* closeBtn = new QPushButton(QStringLiteral("✕"));
    closeBtn->setFixedSize(26, 26);
    closeBtn->setCursor(Qt::PointingHandCursor);
    closeBtn->setFocusPolicy(Qt::NoFocus);
    closeBtn->setStyleSheet(QString(
        "QPushButton{background:transparent; color:%1; border:none;"
        "border-radius:13px; font-size:13px; font-weight:700;}"
        "QPushButton:hover{background:%2; color:%3;}")
        .arg(c.muted, c.btnHover, c.textStrong));
    connect(closeBtn, &QPushButton::clicked, this, &QDialog::reject);

    auto* titleCol = new QVBoxLayout;
    titleCol->setContentsMargins(0, 0, 0, 0);
    titleCol->setSpacing(2);
    titleCol->addWidget(title);
    titleCol->addWidget(subtitle);

    auto* head = new QHBoxLayout;
    head->setContentsMargins(0, 0, 0, 0);
    head->setSpacing(10);
    head->addLayout(titleCol);
    head->addStretch(1);
    head->addWidget(sidePill, 0, Qt::AlignTop);
    head->addWidget(closeBtn, 0, Qt::AlignTop);

    // ── the position, in the numbers a level is judged against ──
    auto* summary = new QFrame;
    summary->setObjectName(QStringLiteral("summaryCard"));
    // #summaryCard, not a bare QFrame selector. QLabel DERIVES from QFrame, so
    // "QFrame{border:...}" draws that border around every label inside the card
    // too — which is why each caption once came out looking like an empty
    // input field. Naming the frame scopes the rule to the card itself.
    summary->setStyleSheet(QString("QFrame#summaryCard{background:%1; border:1px solid %2;"
                                    "border-radius:10px;}")
                           .arg(c.cardBg, c.cardBorder));
    auto* g = new QGridLayout(summary);
    g->setContentsMargins(14, 10, 14, 10);
    g->setVerticalSpacing(7);
    g->setColumnStretch(1, 1);

    auto row = [&](int r, const QString& k, const QString& v, const QString& colour) {
        auto* kl = new QLabel(k);
        kl->setStyleSheet(QString("background:transparent; border:none;"
                                  "color:%1; font-size:12px;").arg(c.muted));
        auto* vl = new QLabel(v);
        vl->setStyleSheet(QString("background:transparent; border:none; color:%1;"
                                  "font-size:12px; font-weight:700;"
                                  "font-family:Consolas,monospace;").arg(colour));
        vl->setAlignment(Qt::AlignRight | Qt::AlignVCenter);
        g->addWidget(kl, r, 0);
        g->addWidget(vl, r, 1);
    };
    row(0, tr("Volume"),     QString::number(m_pos.lots, 'f', 2),             c.textStrong);
    row(1, tr("Open price"), QString::number(m_pos.openPrice, 'f', m_digits), c.textStrong);
    row(2, tr("Current"),    m_pos.currentPrice > 0
                                 ? QString::number(m_pos.currentPrice, 'f', m_digits)
                                 : QStringLiteral("—"),                  c.textStrong);
    {
        // The open P/L, coloured. It is the context for every level being set
        // here, and the dialog was making the trader remember it from the row
        // they clicked.
        const double pl = m_pos.profit;
        row(3, tr("Profit"), QStringLiteral("%1%2")
                                 .arg(pl >= 0 ? "+" : "-", QString::number(qAbs(pl), 'f', 2)),
            pl >= 0 ? c.up : c.down);
    }

    // ── the two legs ──
    auto mkSpin = [&](double value) {
        auto* s = new QDoubleSpinBox;
        s->setDecimals(m_digits);
        s->setRange(0.0, 1e7);
        s->setSingleStep(std::pow(10.0, -m_digits + 1));
        // 0 is reachable whether or not a bracket is already set: on an
        // existing one it means "remove it", on an empty one "don't set one".
        s->setMinimum(0.0);
        s->setValue(value > 0.0 ? value : 0.0);
        s->setMinimumHeight(40);
        s->setAlignment(Qt::AlignLeft | Qt::AlignVCenter);
        // Steppers come from the shared style. Without a sheet that describes
        // the sub-controls the arrows are not drawn at all and the button
        // column is a blank grey block — which is how this dialog shipped.
        s->setStyleSheet(Theme::spinStyle());
        // Let the trader type the whole price. With tracking on, Qt reparses
        // and reformats after every keystroke and drops the cursor at the end,
        // so on a 5-digit instrument only the last characters stayed editable.
        SpinInput::freeTyping({s});
        // Both signals: valueChanged for the steppers and the commit, textEdited
        // for typing, which tracking-off no longer reports. Save is disabled
        // until something changes, and a disabled button swallows the mouse
        // press without moving focus — so nothing would ever commit the typed
        // level and the button could never enable.
        connect(s, &QDoubleSpinBox::valueChanged, this, [this]() { refreshHint(); });
        SpinInput::onTyping(s, this, [this]() { refreshHint(); });
        return s;
    };
    m_sl = mkSpin(m_pos.sl);
    m_tp = mkSpin(m_pos.tp);

    // Each caption takes its leg's colour — a stop is the losing side, a target
    // the winning one — so the two fields are told apart at a glance rather
    // than by reading them. The dot repeats it for anyone who cannot rely on
    // colour alone being obvious at 10px.
    auto legHead = [&](const QString& text, const QString& colour) {
        auto* dot = new QLabel(QStringLiteral("●"));
        dot->setStyleSheet(QString("background:transparent; border:none;"
                                   "color:%1; font-size:9px;").arg(colour));
        auto* l = new QLabel(text);
        l->setStyleSheet(QString("background:transparent; border:none; color:%1;"
                                 "font-size:10px; font-weight:800; letter-spacing:1px;")
                         .arg(colour));
        auto* row2 = new QHBoxLayout;
        row2->setContentsMargins(0, 0, 0, 0);
        row2->setSpacing(6);
        row2->addWidget(dot);
        row2->addWidget(l);
        row2->addStretch(1);
        return row2;
    };

    auto mkDist = [&]() {
        auto* l = new QLabel;
        l->setStyleSheet(QString("background:transparent; border:none;"
                                 "color:%1; font-size:11px;"
                                 "font-family:Consolas,monospace;").arg(c.dim));
        return l;
    };
    m_slDist = mkDist();
    m_tpDist = mkDist();

    auto* form = new QGridLayout;
    form->setHorizontalSpacing(14);
    form->setVerticalSpacing(6);
    form->addLayout(legHead(tr("STOP LOSS"),   c.down), 0, 0);
    form->addLayout(legHead(tr("TAKE PROFIT"), c.up),   0, 1);
    form->addWidget(m_sl,     1, 0);
    form->addWidget(m_tp,     1, 1);
    form->addWidget(m_slDist, 2, 0);
    form->addWidget(m_tpDist, 2, 1);
    form->setColumnStretch(0, 1);
    form->setColumnStretch(1, 1);

    m_hint = new QLabel;
    m_hint->setWordWrap(true);
    m_hint->setStyleSheet(QString("background:transparent; border:none;"
                                  "color:%1; font-size:11px;").arg(c.muted));

    // ── actions ──
    auto* cancel = new QPushButton(tr("Cancel"));
    cancel->setMinimumHeight(40);
    cancel->setCursor(Qt::PointingHandCursor);
    cancel->setStyleSheet(QString(
        "QPushButton{background:transparent; color:%1; border:1px solid %2;"
        "border-radius:10px; font-weight:700;}"
        "QPushButton:hover{border-color:%3; color:%3;}")
        .arg(c.text, c.btnBorder, c.textStrong));
    connect(cancel, &QPushButton::clicked, this, &QDialog::reject);

    m_save = new QPushButton(tr("Save"));
    m_save->setMinimumHeight(40);
    m_save->setCursor(Qt::PointingHandCursor);
    m_save->setStyleSheet(QString(
        "QPushButton{background:%1; color:#ffffff; border:none; border-radius:10px;"
        "font-weight:800;}"
        "QPushButton:hover{background:%2;}"
        "QPushButton:disabled{background:%3; color:%4;}")
        .arg(c.accent, c.accentHover, c.btnBg, c.dim));
    connect(m_save, &QPushButton::clicked, this, &QDialog::accept);

    auto* actions = new QHBoxLayout;
    actions->setSpacing(10);
    actions->addWidget(cancel, 1);
    actions->addWidget(m_save, 2);      // the affirmative action carries more weight

    auto* inner = new QVBoxLayout(card);
    inner->setContentsMargins(20, 18, 20, 18);
    inner->setSpacing(14);
    inner->addLayout(head);
    inner->addWidget(summary);
    inner->addLayout(form);
    inner->addWidget(m_hint);
    inner->addLayout(actions);

    // The outer margin is the room the shadow needs; without it the blur is
    // clipped at the window edge and reads as a grey band.
    auto* outer = new QVBoxLayout(this);
    outer->setContentsMargins(18, 14, 18, 20);
    outer->addWidget(card);

    setMinimumWidth(452);
    refreshHint();
}

// Frameless windows have no title bar to drag, so the card itself is the
// handle. Presses that land on a control never reach here — those widgets
// consume their own.
void ModifyBracketsDialog::mousePressEvent(QMouseEvent* e) {
    if (e->button() == Qt::LeftButton)
        m_dragPos = e->globalPosition().toPoint() - frameGeometry().topLeft();
    QDialog::mousePressEvent(e);
}

void ModifyBracketsDialog::mouseMoveEvent(QMouseEvent* e) {
    if (e->buttons() & Qt::LeftButton)
        move(e->globalPosition().toPoint() - m_dragPos);
    QDialog::mouseMoveEvent(e);
}

// How far each level sits from the price the position would close at, in the
// instrument's own pips. A price on its own says nothing about whether a stop
// is tight or loose; this is the number a trader is actually choosing.
void ModifyBracketsDialog::refreshDistances() {
    const auto& c = Theme::p();
    const double ref = m_pos.currentPrice > 0 ? m_pos.currentPrice : m_pos.openPrice;
    const double pip = std::pow(10.0, -m_digits + 1);

    auto describe = [&](QLabel* out, double level, bool isStop) {
        if (!(level > 0.0)) {
            out->setText(tr("not set"));
            out->setStyleSheet(QString("background:transparent; border:none;"
                                       "color:%1; font-size:11px;"
                                       "font-family:Consolas,monospace;").arg(c.dim));
            return;
        }
        if (!(ref > 0.0) || !(pip > 0.0)) { out->setText(QString()); return; }

        const double pips = (level - ref) / pip;
        const bool below = pips < 0;
        // Which side a level is on is the thing that makes it valid or not, so
        // it is spelled out rather than left to the sign of a number.
        out->setText(tr("%1 pips %2 current")
                         .arg(QString::number(qAbs(pips), 'f', 1),
                              below ? tr("below") : tr("above")));
        // Amber when the level sits on the side that would fire it immediately
        // — a stop above the market for a buy, or a target below it.
        const bool sell = m_pos.side.compare("sell", Qt::CaseInsensitive) == 0;
        const bool wrongSide = isStop ? (sell ? below : !below)
                                      : (sell ? !below : below);
        out->setStyleSheet(QString("background:transparent; border:none;"
                                   "color:%1; font-size:11px;"
                                   "font-family:Consolas,monospace;")
                           .arg(wrongSide ? c.warn : c.dim));
    };

    describe(m_slDist, stopLoss(),   true);
    describe(m_tpDist, takeProfit(), false);
}

void ModifyBracketsDialog::refreshHint() {
    QStringList parts;
    // "be removed" vs "move": clearing to 0 is a materially different action
    // from nudging a level, and worth spelling out before it is saved.
    if (slChanged())
        parts << (stopLoss() <= 0.0 ? tr("stop loss will be removed")
                                    : tr("stop loss will move"));
    if (tpChanged())
        parts << (takeProfit() <= 0.0 ? tr("take profit will be removed")
                                      : tr("take profit will move"));

    // Saying which legs will be sent matters: only the changed ones are, so an
    // untouched bracket is left exactly as the server has it.
    m_hint->setText(parts.isEmpty() ? tr("Nothing changed yet.")
                                    : tr("On save, %1.").arg(parts.join(tr(" and "))));
    m_save->setEnabled(!parts.isEmpty());
    refreshDistances();
}

// Compared with a tolerance below the instrument's last digit: the spin box
// round-trips the value it was given, and an exact == on doubles would call an
// untouched field "changed" often enough to matter.
static bool differs(double a, double b) { return std::fabs(a - b) > 1e-9; }

// Read the text rather than value(): tracking is off, so value() lags a field
// that is still being edited, and both the hint and the saved level have to
// match what the trader sees.
bool   ModifyBracketsDialog::slChanged() const { return differs(stopLoss(), m_slWas); }
bool   ModifyBracketsDialog::tpChanged() const { return differs(takeProfit(), m_tpWas); }
double ModifyBracketsDialog::stopLoss()   const { return SpinInput::typedValue(m_sl); }
double ModifyBracketsDialog::takeProfit() const { return SpinInput::typedValue(m_tp); }
