#pragma once
#include <QDialog>
#include <QPoint>
#include "core/Models.h"

class QLabel;
class QDoubleSpinBox;
class QPushButton;

// Edits Stop Loss / Take Profit on an open position.
//
// Until this existed the only way to move a bracket was to drag its line on
// the chart, which is why the blotter's S/L and T/P columns looked broken:
// they showed the levels but nothing let you change them.
//
// The two legs are sent SEPARATELY, and only when changed — the endpoint does
// a partial update, so posting an untouched leg from a snapshot that is up to
// four seconds old would quietly overwrite a level the server had already
// moved (a triggered SL, or a change made from another device).
//
// Presented as a frameless rounded card with its own header, like the sign-in
// dialog: the OS title bar put a second, smaller copy of the title above the
// real one and boxed the whole thing in square chrome that matched nothing
// else on screen.
class ModifyBracketsDialog : public QDialog {
    Q_OBJECT
public:
    ModifyBracketsDialog(const OpenPosition& pos, int digits, QWidget* parent = nullptr);

    bool   slChanged() const;
    bool   tpChanged() const;
    double stopLoss() const;      // 0 => remove the bracket
    double takeProfit() const;

protected:
    // Frameless → the card is dragged by any empty part of it.
    void mousePressEvent(QMouseEvent* e) override;
    void mouseMoveEvent(QMouseEvent* e) override;

private:
    void refreshHint();
    // The per-leg line under each field: how far the level sits from the price
    // the position would close at, in the instrument's own pips, and which way.
    void refreshDistances();

    OpenPosition m_pos;
    int    m_digits;
    double m_slWas;
    double m_tpWas;
    QDoubleSpinBox* m_sl;
    QDoubleSpinBox* m_tp;
    QLabel* m_slDist;
    QLabel* m_tpDist;
    QLabel* m_hint;
    QPushButton* m_save;
    QPoint  m_dragPos;
};
