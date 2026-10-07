#pragma once
#include <QDialog>
#include <QStringList>
#include <QVector>
#include "core/Models.h"

class QTreeWidget;
class QTreeWidgetItem;
class QLineEdit;
class QLabel;

// View > Symbols — MT5's Symbols window.
//
// Every instrument the broker lists, grouped the way the server groups them,
// with a tick per row for "show this in Market Watch". Market Watch's own
// right-click menu can hide one instrument or show them all; this is where a
// trader picks the twenty they actually trade out of the couple of hundred on
// offer, which is not a thing a per-row context menu can do.
//
// The dialog owns no state that matters: it is handed the instrument table and
// the current hidden set, and hands a new hidden set back. The window owns the
// Config, exactly as WatchlistWidget's own preferences work.
class SymbolsDialog : public QDialog {
    Q_OBJECT
public:
    SymbolsDialog(const QVector<SymbolSpec>& symbols, const QStringList& hidden,
                  QWidget* parent = nullptr);

    // Instruments to keep OUT of Market Watch, after the trader's edits.
    QStringList hiddenSymbols() const;

signals:
    // "Specification" on a row — the same sheet the Market Watch right-click
    // opens, so the two routes land on one dialog rather than two copies of it.
    void specificationRequested(const QString& symbol);

private:
    void build(const QVector<SymbolSpec>& symbols, const QStringList& hidden);
    void applyFilter(const QString& text);
    // Sets every VISIBLE row's tick. Visible rather than every row: the buttons
    // sit under a search box, and "Show all" while filtered to "USD" plainly
    // means those, not the whole list.
    void setAllVisibleChecked(bool on);
    void updateCount();

    QTreeWidget* m_tree;
    QLineEdit*   m_search;
    QLabel*      m_count;
};
