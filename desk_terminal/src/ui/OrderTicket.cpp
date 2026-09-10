#include "ui/OrderTicket.h"
#include "ui/Theme.h"
#include <QMouseEvent>
#include "ui/SpinInput.h"
#include <QDoubleSpinBox>
#include <QPushButton>
#include <QLabel>
#include <QHBoxLayout>
#include <QVBoxLayout>
#include <QPainter>
#include <QStyle>
#include <QStyleOption>
#include <QFontMetrics>
#include <cmath>

// Small uppercase caption used beside the bracket inputs.
static QLabel* caption(const QString& text, QList<QLabel*>& sink) {
    auto* l = new QLabel(text);
    sink << l;
    return l;
}

OrderTicket::Tile OrderTicket::makeTile(const QString& cap) {
    Tile t;
    t.btn = new QPushButton;
    // Sized to sit inside the chart's toolbar band rather than hang below it.
    t.btn->setFixedHeight(32);
    // A floor, not a cap: wide enough for a 7-character price ("1.14088" /
    // "4096.95") at the tile's font size, and the layout still grows it for
    // longer ones like "65430.27" rather than eliding the price it exists to
    // show.
    t.btn->setMinimumWidth(48);
    t.btn->setCursor(Qt::PointingHandCursor);
    // No focus ring. The style sheet below already says border:none, but Fusion
    // paints the focus rectangle separately from the border property, so a
    // clicked tile kept a blue outline until something else took focus.
    // NoFocus is right for the strip on its own merits too: it floats over the
    // chart, and a one-click BUY should not pull keyboard focus off it.
    t.btn->setFocusPolicy(Qt::NoFocus);

    auto* v = new QVBoxLayout(t.btn);
    v->setContentsMargins(4, 1, 4, 2);
    v->setSpacing(0);
    t.caption = new QLabel(cap);
    t.caption->setAlignment(Qt::AlignCenter);
    t.price = new QLabel("—");
    t.price->setAlignment(Qt::AlignCenter);
    v->addWidget(t.caption);
    v->addWidget(t.price);

    // Clicks must reach the button, not the labels sitting on top of it.
    for (QWidget* w : t.btn->findChildren<QWidget*>())
        w->setAttribute(Qt::WA_TransparentForMouseEvents, true);
    return t;
}

void OrderTicket::styleTile(const Tile& t, const QString& base, const QString& hover) {
    // padding:0 — the global sheet gives every QPushButton 4px/10px, which on
    // these tiles is dead space around a label that already carries its own
    // margins, and it made the strip ~40px wider than it needed to be.
    // outline:none on every state, not just the base rule. `border:none` alone
    // does not remove the focus ring — Qt draws that from the `outline`
    // property, and a pseudo-state selector (:focus) outranks the plain
    // QPushButton rule, so it has to be named explicitly or the ring survives.
    // setFocusPolicy(Qt::NoFocus) in makeTile() should already stop the button
    // ever being focused; this is the belt to that pair of braces, and it also
    // covers the ring some styles paint on :pressed.
    t.btn->setStyleSheet(QString(
        // Square, not rounded: a 3px radius leaves the card fill visible in the
        // four corners, which is the same light-outline artefact the zeroed
        // margins above exist to kill — just smaller.
        "QPushButton{background:%1; border:none; outline:none; border-radius:0; padding:0;}"
        "QPushButton:hover{background:%2; border:none; outline:none;}"
        "QPushButton:pressed{background:%1; border:none; outline:none;}"
        "QPushButton:focus{background:%1; border:none; outline:none;}"
        "QPushButton:disabled{background:%3; border:none; outline:none;}")
        .arg(base, hover, Theme::p().panelAlt));
    t.caption->setStyleSheet("background:transparent; color:rgba(255,255,255,0.88);"
                             "font-size:9px; font-weight:800; letter-spacing:0.8px;");
    t.price->setStyleSheet("background:transparent; color:#ffffff; font-size:11px;"
                           "font-weight:800; font-family:Consolas,monospace;");
}

OrderTicket::OrderTicket(QWidget* parent) : QWidget(parent) {
    // Opaque, bordered card — it floats over the chart canvas and has to stay
    // legible against candles of any colour.
    setAutoFillBackground(true);

    // No symbol label: the chart legend sits immediately to the left and already
    // names the symbol. Carrying it here only widened the strip until it
    // overlapped that legend text. The spread stays — nothing else shows it.
    m_spreadLabel = new QLabel("—");

    auto* headRow = new QHBoxLayout;
    headRow->setContentsMargins(0, 0, 0, 0);
    headRow->setSpacing(6);
    headRow->addWidget(m_spreadLabel);
    headRow->addStretch();

    // ── the two price tiles + the volume stepper between them ──
    m_sell = makeTile(tr("SELL"));
    m_buy  = makeTile(tr("BUY"));
    // typedValue, not value(): the tiles are deliberately NoFocus, so clicking
    // one never takes focus off a spin box, and with keyboardTracking disabled a
    // box only adopts its typed text on focus-out. Reading value() here would
    // send the volume from before the trader retyped it.
    // The bracket row IS the switch. Collapsed — which is how the strip opens —
    // an order goes out bare; open, it carries whatever the two boxes show.
    // That is what lets the boxes always hold a real price without every
    // one-click order suddenly acquiring a stop.
    auto send = [this](const QString& side) {
        const double reference = (side == "BUY") ? m_ask : m_bid;
        const bool bracketed = m_bracketRow && !m_bracketRow->isHidden();
        double sl = 0.0, tp = 0.0;
        if (bracketed) {
            QString why;
            if (!bracketsValidFor(side, reference, &why)) {
                emit rejected(why);
                return;
            }
            sl = SpinInput::typedValue(m_sl);
            tp = SpinInput::typedValue(m_tp);
        }
        // typedValue, not value(): the tiles are deliberately NoFocus, so
        // clicking one never takes focus off a spin box, and with
        // keyboardTracking disabled a box only adopts its typed text on
        // focus-out. Reading value() here would send the volume from before
        // the trader retyped it.
        const double lots = SpinInput::typedValue(m_volume);
        if (side == "BUY") emit buy(m_spec.symbol, lots, sl, tp);
        else               emit sell(m_spec.symbol, lots, sl, tp);
    };
    connect(m_sell.btn, &QPushButton::clicked, this, [send]() { send(QStringLiteral("SELL")); });
    connect(m_buy.btn,  &QPushButton::clicked, this, [send]() { send(QStringLiteral("BUY")); });

    m_volume = new QDoubleSpinBox;
    m_volume->setDecimals(2);
    m_volume->setRange(0.01, 100.0);
    m_volume->setSingleStep(0.01);
    m_volume->setValue(0.10);
    m_volume->setAlignment(Qt::AlignCenter);
    m_volume->setButtonSymbols(QAbstractSpinBox::NoButtons);
    // 36px clipped "0.10" to "0.1(" — a spin box needs room for the caret and
    // frame on top of the digits.
    m_volume->setFixedWidth(42);
    // No spin buttons: the wheel and the up/down keys already step the value,
    // and on a strip that floats over the chart the width matters more.
    m_volume->setToolTip(tr("Volume in lots — scroll or use ↑ / ↓ to step"));

    auto* tiles = new QHBoxLayout;
    tiles->setContentsMargins(0, 0, 0, 0);
    // Flush, no gap. Any spacing here lets the card's own fill through between
    // the coloured tiles, and against a red or green block that thin light line
    // reads as a BORDER on the button rather than as the card behind it. Same
    // reason the row's horizontal margins are 0 in the outer layout below.
    tiles->setSpacing(0);
    tiles->addWidget(m_sell.btn);
    tiles->addWidget(m_volume);
    tiles->addWidget(m_buy.btn);

    // ── collapsible S/L + T/P row ──
    m_sl = new SpinInput::PriceSpin;
    m_tp = new SpinInput::PriceSpin;
    SpinInput::freeTyping({m_volume, m_sl, m_tp});
    for (QDoubleSpinBox* s : {m_sl, m_tp}) {
        s->setDecimals(5);
        // Capped at 1e6 so the box does not size itself for a 10-digit value it
        // will never hold — no instrument here comes near it.
        s->setRange(0.0, 1e6);
        // No "none" placeholder. An empty-looking box gave the mouse nothing
        // to work with and told the trader nothing about where a level would
        // go; these now always hold a real price, seeded from the market.
        // Whether the brackets are USED is decided by the row being open,
        // which is what the ⌄ toggle beside the volume box is for.
        s->setAlignment(Qt::AlignCenter);
        // Arrows, unlike the volume box beside them. Volume steps in lots a
        // trader knows by heart; a price does not, and without a control to
        // drag there was no way to reach one except typing it in full.
        s->setButtonSymbols(QAbstractSpinBox::UpDownArrows);
        s->setFixedWidth(104);                // + the arrows' column
        // Native steppers need vertical room to sit as two halves; squeezed
        // into the strip's default row height they render as slivers.
        s->setMinimumHeight(26);
    }

    m_closeBtn = new QPushButton(tr("Close all"));
    m_closeBtn->setCursor(Qt::PointingHandCursor);
    m_closeBtn->setFocusPolicy(Qt::NoFocus);   // same focus-ring reason as the tiles
    m_closeBtn->setToolTip(tr("Close every open position for this symbol"));
    connect(m_closeBtn, &QPushButton::clicked, this, [this]() { emit closeAll(m_spec.symbol); });

    auto* brackets = new QHBoxLayout;
    brackets->setContentsMargins(0, 0, 0, 0);
    brackets->setSpacing(5);
    brackets->addWidget(caption(tr("S/L"), m_formLabels));
    brackets->addWidget(m_sl);
    brackets->addWidget(caption(tr("T/P"), m_formLabels));
    brackets->addWidget(m_tp);
    brackets->addStretch();
    brackets->addWidget(m_closeBtn);
    m_bracketRow = new QWidget;
    m_bracketRow->setLayout(brackets);
    m_bracketRow->hide();

    m_moreBtn = new QPushButton(QStringLiteral("⌄"));
    m_moreBtn->setFixedSize(18, 14);
    m_moreBtn->setCursor(Qt::PointingHandCursor);
    m_moreBtn->setFocusPolicy(Qt::NoFocus);    // same focus-ring reason as the tiles
    m_moreBtn->setToolTip(tr("Show S/L and T/P"));
    connect(m_moreBtn, &QPushButton::clicked, this, [this]() {
        const bool show = m_bracketRow->isHidden();
        m_bracketRow->setVisible(show);
        m_moreBtn->setText(show ? QStringLiteral("⌃") : QStringLiteral("⌄"));
        m_moreBtn->setToolTip(show ? tr("Hide S/L and T/P") : tr("Show S/L and T/P"));
        adjustSize();
    });
    headRow->addWidget(m_moreBtn);

    auto* lay = new QVBoxLayout(this);
    // Zero horizontal margin: 3px of card fill down each side of the tile row
    // was the "border" on the BUY/SELL buttons. The card still shows above the
    // tiles (behind the spread label) and below (behind the S/L / T/P row),
    // which is where it is actually wanted — it is only against the coloured
    // tiles that it reads as an outline.
    lay->setContentsMargins(0, 2, 0, 0);
    lay->setSpacing(2);
    lay->addLayout(headRow);
    lay->addLayout(tiles);
    lay->addWidget(m_bracketRow);

    setEnabled(false); // enabled once a symbol is chosen

    applyTheme();
    connect(Theme::notifier(), &Theme::Notifier::changed, this, &OrderTicket::applyTheme);
}

void OrderTicket::paintEvent(QPaintEvent*) {
    QStyleOption opt;
    opt.initFrom(this);
    QPainter p(this);
    style()->drawPrimitive(QStyle::PE_Widget, &opt, &p, this);
}

void OrderTicket::applyTheme() {
    const auto& c = Theme::p();

    // No outline. The card is still opaque — it floats over the chart canvas and
    // has to stay legible against candles of any colour — but the 1px border it
    // used to carry drew a hard box around the BUY/SELL tiles. In light mode the
    // card (#f4f5f7) sits on a white chart, so that border was the only thing
    // visible: the strip read as a framed widget stuck onto the chart rather
    // than part of the toolbar. The fill alone separates it well enough in both
    // themes, since neither panel colour matches its chart background.
    setToolTip(tr("Drag to move this panel. Double-click it to put it back."));
    setStyleSheet(QString("OrderTicket{background:%1; border:none; border-radius:4px;}")
                  .arg(c.panel));
    // The global sheet paints every QWidget opaque; the inner container must be
    // transparent or it stamps a window-coloured block across the card.
    m_bracketRow->setStyleSheet("background:transparent;");
    m_spreadLabel->setStyleSheet(QString("background:transparent; color:%1; font-size:10px;"
                                         "font-weight:700;").arg(c.muted));

    styleTile(m_sell, c.down, Theme::isDark() ? "#f04148" : "#d92b38");
    styleTile(m_buy,  c.up,   Theme::isDark() ? "#2ec27e" : "#169342");

    for (QLabel* l : m_formLabels)
        l->setStyleSheet(QString("background:transparent; color:%1; font-size:10px;"
                                 "font-weight:700;").arg(c.muted));

    // Ghost chevron: a bordered box here read as a second frame stacked on the
    // card, which is most of what made the strip look boxed in. It only picks up
    // a background on hover.
    m_moreBtn->setStyleSheet(QString(
        "QPushButton{background:transparent; color:%1; border:none; border-radius:2px;"
        "font-size:8px; font-weight:800; padding:0;}"
        "QPushButton:hover{background:%2; color:%3;}")
        .arg(c.muted, c.btnHover, c.textStrong));

    const QString input = QString(
        "QDoubleSpinBox{background:%1; color:%2; border:1px solid %3; border-radius:3px;"
        "padding:3px 2px; font-size:11px; font-weight:700; font-family:Consolas,monospace;}"
        "QDoubleSpinBox:focus{border-color:%4;}")
        .arg(c.inputBg, c.textStrong, c.inputBorder, c.accent);
    m_volume->setStyleSheet(input);

    // The two price boxes carry steppers, and those come from the shared
    // style — the same one the S/L / T/P dialog uses, so the arrows cannot
    // drift apart between the two places a trader sets a level.
    m_sl->setStyleSheet(Theme::spinStyle());
    m_tp->setStyleSheet(Theme::spinStyle());

    // Destructive — stays a quiet ghost button and only tints on hover, so a
    // mis-click next to BUY/SELL never looks inviting.
    m_closeBtn->setStyleSheet(QString(
        "QPushButton{background:transparent; color:%1; border:1px solid %2;"
        "border-radius:3px; font-size:10px; font-weight:700; padding:3px 8px;}"
        "QPushButton:hover{background:%3; color:%4; border-color:%4;}")
        .arg(c.muted, c.btnBorder,
             Theme::isDark() ? "rgba(224,27,36,0.16)" : "rgba(192,28,40,0.10)", c.down));
}

void OrderTicket::setSymbolSpec(const SymbolSpec& spec) {
    // Drop the old instrument's prices with it, so seedBrackets() cannot place
    // a gold level around a EURUSD quote in the moment between the two.
    if (spec.symbol != m_spec.symbol) { m_bid = 0.0; m_ask = 0.0; }
    m_spec   = spec;
    m_digits = spec.digits;
    m_volume->setRange(spec.minLot, spec.maxLot);
    m_volume->setSingleStep(spec.lotStep);
    if (m_volume->value() < spec.minLot) m_volume->setValue(spec.minLot);
    m_sl->setDecimals(spec.digits);
    m_tp->setDecimals(spec.digits);
    // One pip per step, from the instrument's own precision — a whole 1.0 of
    // Qt's default is meaningless on a price and useless on every instrument
    // here.
    const double step = std::pow(10.0, -spec.digits + 1);
    m_sl->setSingleStep(step);
    m_tp->setSingleStep(step);
    // Clear the brackets. A level is only meaningful against the instrument it
    // was typed for, and carrying one across was actively dangerous: a trader
    // who set S/L 4255 on XAUUSD and then switched to AUDUSD had 4255 still
    // sitting in the box, and the next one-click BUY sent it — a stop loss
    // ~6000x the price, on a pair quoted at 0.70. (Reported from the field:
    // "moved to other symbols same sl and tp placing".)
    //
    // The row is collapsed too, so the next order starts bracket-free rather
    // than with two fields a trader has to remember to check.
    // Cleared and marked unseeded: the next quote for the NEW instrument is
    // what the levels get built from. Carrying the old ones over is the bug
    // described above; seeding from a price this instrument has not quoted yet
    // would be the same bug with extra steps.
    m_seeded = false;
    m_sl->setValue(0.0);
    m_tp->setValue(0.0);
    if (m_bracketRow && !m_bracketRow->isHidden()) {
        m_bracketRow->hide();
        m_moreBtn->setText(QStringLiteral("⌄"));
        m_moreBtn->setToolTip(tr("Show S/L and T/P"));
    }

    m_sell.price->setText("—");
    m_buy.price->setText("—");
    m_spreadLabel->setText("—");
    // Re-floor for the new instrument rather than carrying the last one's
    // width: coming back to EURUSD from BTCUSD would otherwise leave the strip
    // sized for a six-figure price. Seeded from the digit count; the first
    // quote grows it further if the magnitude needs it.
    const int floorPx = tileWidthFor(QStringLiteral("0.").leftJustified(spec.digits + 2, '0'));
    m_sell.btn->setMinimumWidth(floorPx);
    m_buy.btn->setMinimumWidth(floorPx);
    adjustSize();
    emit sizeHintChanged();
    setEnabled(true);
}

// Stop below the market, target above it, each a short way out. 0.1% of the
// price rather than a fixed number of pips: it lands sensibly on a 1.16 FX
// pair and on gold at 4400 alike, where any fixed distance suits one and is
// absurd for the other.
void OrderTicket::seedBrackets(double price) {
    if (!(price > 0.0)) return;
    const double away = qMax(price * 0.001, std::pow(10.0, -m_digits + 1) * 5);
    m_sl->setValue(price - away);
    m_tp->setValue(price + away);
    m_seeded = true;
}

// A stop loss on the wrong side of the market is not a stop loss — it fills or
// is refused the moment it is sent. The strip is one click from a live order,
// so it says so here rather than letting the server answer for it.
bool OrderTicket::bracketsValidFor(const QString& side, double reference,
                                   QString* why) const {
    if (!(reference > 0.0)) return true;          // no quote yet; let it through
    const double sl = SpinInput::typedValue(m_sl);
    const double tp = SpinInput::typedValue(m_tp);
    const bool buy = (side == "BUY");

    if (sl > 0.0) {
        const bool ok = buy ? (sl < reference) : (sl > reference);
        if (!ok) {
            if (why) *why = buy ? tr("Stop loss must be below the market for a BUY.")
                                : tr("Stop loss must be above the market for a SELL.");
            return false;
        }
    }
    if (tp > 0.0) {
        const bool ok = buy ? (tp > reference) : (tp < reference);
        if (!ok) {
            if (why) *why = buy ? tr("Take profit must be above the market for a BUY.")
                                : tr("Take profit must be below the market for a SELL.");
            return false;
        }
    }
    return true;
}

// ── dragging ───────────────────────────────────────────────────────────────
//
// The strip floats over the chart rather than sitting in a layout, so moving
// it is just a matter of moving the widget and remembering where. Everything
// is clamped to the parent so it cannot be dragged off the edge and lost.

void OrderTicket::setPositionRatio(const QPointF& r) {
    m_posRatio = r;
}

void OrderTicket::mousePressEvent(QMouseEvent* e) {
    if (e->button() != Qt::LeftButton) { QWidget::mousePressEvent(e); return; }
    m_dragging = true;
    m_dragFrom = e->position().toPoint();
    setCursor(Qt::ClosedHandCursor);
    e->accept();
}

void OrderTicket::mouseMoveEvent(QMouseEvent* e) {
    if (!m_dragging || !parentWidget()) { QWidget::mouseMoveEvent(e); return; }

    const QWidget* host = parentWidget();
    QPoint p = mapToParent(e->position().toPoint()) - m_dragFrom;
    // Fully inside the chart, always: a strip half off the pane is a strip
    // whose BUY price cannot be read.
    p.setX(qBound(0, p.x(), qMax(0, host->width()  - width())));
    p.setY(qBound(0, p.y(), qMax(0, host->height() - height())));
    move(p);
    e->accept();
}

void OrderTicket::mouseReleaseEvent(QMouseEvent* e) {
    if (!m_dragging) { QWidget::mouseReleaseEvent(e); return; }
    m_dragging = false;
    unsetCursor();

    if (const QWidget* host = parentWidget()) {
        const int roomX = qMax(1, host->width()  - width());
        const int roomY = qMax(1, host->height() - height());
        m_posRatio = QPointF(double(x()) / roomX, double(y()) / roomY);
        emit movedTo(m_posRatio);
    }
    e->accept();
}

// Double-click puts it back where the chart wants it. A strip dragged into a
// corner and forgotten is otherwise a nuisance with no obvious way out.
void OrderTicket::mouseDoubleClickEvent(QMouseEvent* e) {
    if (e->button() != Qt::LeftButton) { QWidget::mouseDoubleClickEvent(e); return; }
    m_posRatio = QPointF(-1.0, -1.0);
    emit movedTo(m_posRatio);
    emit sizeHintChanged();          // the host re-places it on this
    e->accept();
}

void OrderTicket::updateQuote(const Quote& q) {
    if (q.symbol != m_spec.symbol) return;
    // SELL fills at the bid, BUY at the ask — each tile shows the price you get.
    m_sell.price->setText(QString::number(q.bid, 'f', m_digits));
    m_buy.price->setText(QString::number(q.ask, 'f', m_digits));
    const double points = q.spread * std::pow(10.0, m_digits - 1);
    m_spreadLabel->setText(QString::number(points, 'f', 1));

    m_bid = q.bid;
    m_ask = q.ask;
    m_sl->setMarketPrice(q.bid);
    m_tp->setMarketPrice(q.bid);
    // The first quote for an instrument is what the levels are built from —
    // before it there is no price to place them around.
    if (!m_seeded) seedBrackets(q.bid);

    // A price can outgrow the width the tiles were sized for — BTCUSD crossing
    // into six figures is the obvious case, and 64816.00 already clipped to
    // "4816.0" against the old 48px floor. Widen on demand and tell the host to
    // re-place the strip. Grow-only within a symbol: shrinking on every tick
    // would make the strip twitch as the last digit changes width.
    const int need = tileWidthFor(QString::number(q.ask, 'f', m_digits));
    if (need > m_sell.btn->minimumWidth()) {
        m_sell.btn->setMinimumWidth(need);
        m_buy.btn->setMinimumWidth(need);
        adjustSize();
        emit sizeHintChanged();
    }
}

int OrderTicket::tileWidthFor(const QString& sample) const {
    // Measured, not guessed. The old hard-coded 48px floor happened to be
    // almost exactly eight Consolas characters at this size, so an eight-digit
    // price fitted only if the button had no padding — which it does.
    const QFontMetrics fm(m_sell.price->font());
    // +2 characters of headroom: one for a digit the price may still gain, one
    // so the glyphs are not flush against the tile edge.
    return fm.horizontalAdvance(sample + "00") + 8;
}
