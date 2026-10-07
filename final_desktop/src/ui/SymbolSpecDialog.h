#pragma once
#include <QDialog>
#include <QHash>
#include "core/Models.h"

class QLabel;
class QTableWidget;

// MT5's "Specification" panel: right-click an instrument in Market Watch and
// read its contract terms before trading it.
//
// The terminal already knew all of this and showed none of it. Lot step, the
// minimum size, the contract size and the price precision decided what every
// order ticket would accept, and a trader had to discover each one by having
// an order rejected. The swaps and the commission decide what a position
// costs to hold and were not on screen anywhere at all.
//
// Two sources, because they live on two gateways:
//   * SymbolSpec — already in hand from /api/algo/symbols, so the panel opens
//     filled in rather than empty, on the very first frame.
//   * InstrumentSpec — fetched per instrument when the panel opens (pip size,
//     configured spread, commission, swaps). Those rows read "loading…" until
//     it lands, and say so plainly if it never does.
//
// Bid, ask and the live spread keep ticking while the panel is open: MT5's
// does, and a spread quoted from a frozen snapshot is the one number here that
// would be actively misleading.
class SymbolSpecDialog : public QDialog {
    Q_OBJECT
public:
    SymbolSpecDialog(const SymbolSpec& spec, const Quote& quote, QWidget* parent = nullptr);

public slots:
    // Fed from PriceStream while the panel is open. Quotes for other
    // instruments are ignored.
    void updateQuote(const Quote& q);
    // Answer to ApiClient::fetchInstrumentSpec. A spec for another symbol, or
    // one that failed, is handled here rather than by the caller.
    void setInstrumentSpec(const InstrumentSpec& spec);
    void applyTheme();

private:
    // Adds one "Property | Value" row and remembers the value cell under `key`
    // so it can be rewritten when the fetch or a tick arrives.
    void addRow(const QString& key, const QString& caption, const QString& value);
    void addSection(const QString& caption);
    void setValue(const QString& key, const QString& text);
    void renderQuote();
    void renderExtended();

    SymbolSpec     m_spec;
    Quote          m_quote;
    InstrumentSpec m_ext;
    bool           m_extArrived = false;

    QTableWidget*             m_table;
    QLabel*                   m_heading;
    QLabel*                   m_note;
    QHash<QString, int>       m_rowOf;   // key -> table row
};
