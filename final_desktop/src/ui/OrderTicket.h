#pragma once
#include <QWidget>
#include <QList>
#include "core/Models.h"
#include "ui/SpinInput.h"

QT_BEGIN_NAMESPACE
class QDoubleSpinBox;
class QPushButton;
class QLabel;
QT_END_NAMESPACE

// MT5-style one-click trading strip, floated over the top-left of the chart:
//
//     [ SELL 1.24995 ] [ 1.00 ] [ BUY 1.25010 ]
//     ⌄ S/L [      ]  T/P [      ]      Close all
//
// The volume field has no spin buttons: they cost width on a strip that sits on
// top of the chart, and the wheel plus the up/down keys already step it.
//
// The two price tiles ARE the action buttons (SELL fills at bid, BUY at ask).
// The S/L / T/P row is collapsed by default — MT5 keeps one-click trading to a
// single row, and brackets are normally dragged straight onto the chart by the
// position overlay. The row is still here because typed entry is a real feature
// of this terminal, it is just out of the way until asked for.
class OrderTicket : public QWidget {
    Q_OBJECT
public:
    explicit OrderTicket(QWidget* parent = nullptr);

    void setSymbolSpec(const SymbolSpec& spec);

    // Where the trader has dragged the strip, as a fraction of the room it can
    // move in: 0 is hard against the top/left of the chart, 1 against the
    // bottom/right. Negative means untouched, and the host places it itself.
    //
    // A fraction rather than a pixel offset because the strip floats over a
    // pane whose size changes — a window resize, a 1/2/4 grid switch, the
    // blotter being dragged taller. Pixels would put it off the edge; a
    // fraction keeps it where it looks like it was left.
    QPointF positionRatio() const { return m_posRatio; }
    bool hasCustomPosition() const { return m_posRatio.x() >= 0.0 && m_posRatio.y() >= 0.0; }
    void setPositionRatio(const QPointF& r);

public slots:
    void updateQuote(const Quote& q);   // only applied if it matches current symbol
    void applyTheme();

protected:
    // Dragging. Only presses that land on the strip's own background get here
    // — the tiles, the volume box and the bracket fields consume their own
    // mouse events, so a drag can never start on a control and a click on BUY
    // can never turn into a drag.
    void mousePressEvent(QMouseEvent* e) override;
    void mouseMoveEvent(QMouseEvent* e) override;
    void mouseReleaseEvent(QMouseEvent* e) override;
    void mouseDoubleClickEvent(QMouseEvent* e) override;

    // A plain QWidget subclass ignores `background`/`border` from a style sheet
    // unless it draws PE_Widget itself. Without this the strip is invisible
    // chrome floating on the candles.
    void paintEvent(QPaintEvent* e) override;

signals:
    void buy(const QString& symbol, double volume, double sl, double tp);
    void sell(const QString& symbol, double volume, double sl, double tp);
    void closeAll(const QString& symbol);
    // The strip refused to send an order, with the reason. It has no status
    // area of its own — the window's status bar is where a trader already
    // looks for the outcome of a trade.
    void rejected(const QString& reason);
    // The strip has no parent layout — it is positioned by hand over the chart
    // — so nothing notices when its size hint changes. Raised when the tiles
    // are re-sized for a new symbol, so the host can re-run its placement
    // instead of leaving the strip at a width that clips the price.
    void sizeHintChanged();
    // The strip was dragged to a new place. Carries the fraction, which is what
    // gets saved — the strip does not own the Config.
    void movedTo(const QPointF& ratio);

private:
    // A price tile: SELL/BUY caption over the live price, whole thing clickable.
    struct Tile {
        QPushButton* btn = nullptr;
        QLabel*      caption = nullptr;
        QLabel*      price = nullptr;
    };
    Tile makeTile(const QString& caption);
    void styleTile(const Tile& t, const QString& base, const QString& hover);
    // Width a tile needs to show `sample` in full, from the price label's own
    // font metrics rather than a hard-coded pixel guess.
    int  tileWidthFor(const QString& sample) const;

    // Seeds the two bracket boxes from the market: stop below, target above,
    // both a short distance out. Runs when the instrument changes and on the
    // first quote for it, and never overwrites a level the trader has set.
    void seedBrackets(double price);
    // True when the levels make sense for `side` ("BUY" | "SELL").
    bool bracketsValidFor(const QString& side, double reference, QString* why) const;

    QPointF m_posRatio{-1.0, -1.0};   // where the trader put it; <0 = untouched
    QPoint  m_dragFrom;               // cursor offset inside the strip
    bool    m_dragging = false;

    SymbolSpec m_spec;
    int    m_digits = 5;
    // The last quote, for seeding and for validating a level against the price
    // the order would actually fill at.
    double m_bid = 0.0;
    double m_ask = 0.0;
    bool   m_seeded = false;      // the boxes hold levels for THIS instrument

    QLabel*         m_spreadLabel;
    Tile            m_sell;
    Tile            m_buy;
    QDoubleSpinBox* m_volume;
    // PriceSpin, not a plain box: these rest at "none" and jump to the market
    // price on the first step, so a level can be dialled in with the mouse.
    SpinInput::PriceSpin* m_sl;
    SpinInput::PriceSpin* m_tp;
    QPushButton*    m_closeBtn;
    QPushButton*    m_moreBtn;      // reveals the S/L / T/P row
    QWidget*        m_bracketRow;
    QList<QLabel*>  m_formLabels;
};
