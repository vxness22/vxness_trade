#pragma once
#include <QWidget>
#include <QDate>
#include <QHash>
#include "core/Models.h"

class QTabWidget;
class QTableWidget;
class QComboBox;
class QDateEdit;
class QPushButton;
class QLabel;
class NewsPanel;
class CalendarPanel;

// MT5's bottom blotter. Three tabs — Trade (open positions with live P/L),
// Pending orders, and closed-trade History — using MT5's column set:
// Symbol | Ticket | Time | Type | Volume | Price | S/L | T/P | Price | Profit.
//
// MT5's third tab is Journal; there is no log store behind this terminal, so
// that tab is deliberately absent rather than faked. Data is pushed in by
// MainWindow, which polls the REST endpoints.
//
// The ✕ on a row closes THAT position and nothing else. It used to emit a
// symbol and close every position for it, which meant a trader with two BTCUSD
// lots open lost both when they meant to close one.
class PositionsPanel : public QWidget {
    Q_OBJECT
public:
    explicit PositionsPanel(QWidget* parent = nullptr);

    // Writes the History tab out as a standalone HTML statement — MT5's
    // "Report", and the form a trader's accountant or broker asks for.
    // Public because View > Reports > Summary opens it as well as the panel's
    // own "Save report" button.
    void exportHistoryReport();

    // The closed trades the panel last received, UNFILTERED, plus the account
    // they belong to. View > Reports computes its tables from these rather than
    // re-fetching: the blotter already polls them, and a report that disagreed
    // with the History tab beside it would be the worse bug.
    QVector<HistoryTrade> history() const { return m_lastHistory; }
    AccountInfo account() const { return m_lastAccount; }

public slots:
    void setPositions(const QVector<OpenPosition>& positions);
    void setOrders(const QVector<PendingOrder>& orders);
    void setHistory(const QVector<HistoryTrade>& history);
    void setTransactions(const QVector<Transaction>& txns);

    // Only the balance and currency are used, for the History summary's
    // closing figure. Everything else about the account is the account
    // panel's business.
    void setAccount(const AccountInfo& account);

    // The trader's name, for the statement's header. It lives in the signed-in
    // session rather than in any account payload, so the window hands it over.
    void setTraderName(const QString& name);

    // Live headlines for the instrument in focus — see NewsPanel.
    void setNewsSymbol(const QString& symbol);
    // Macro releases for the economies behind that instrument — see
    // CalendarPanel. Separate setter because the calendar only reacts when its
    // country filter is following the symbol.
    void setCalendarSymbol(const QString& symbol);

    // Price precision per instrument, fed from the symbol table. The blotter
    // has no other way to know it: OpenPosition / PendingOrder carry prices
    // but not the digits they should be shown at.
    void setSymbolDigits(const QHash<QString, int>& digits);

    // ── The blotter's right-click menu ────────────────────────────────
    //
    // MetaTrader puts the period, the report and the column switches on a
    // right-click over the table, and the desk asked for the same — by name,
    // for the column half: "need selected n de select particular column
    // names".
    //
    // Columns are named rather than numbered: keys are "<tab>/<header>", so a
    // column added to a tab later cannot shift every stored index along and
    // hide the wrong things. The panel does not own the Config, so it takes the
    // set in and hands changes back, exactly as Market Watch already does.
    void setHiddenColumns(const QStringList& keys);
    QStringList hiddenColumns() const { return m_hiddenCols; }
    // Auto Arrange on: the columns share the width. Off: they keep their own
    // and can be dragged, which is the only way to make one wider than a share.
    void setAutoArrange(bool on);
    bool autoArrange() const { return m_autoArrange; }
    void setGridVisible(bool on);
    bool gridVisible() const { return m_gridOn; }

    void setCollapsed(bool collapsed);
    bool isCollapsed() const { return m_collapsed; }
    void setPrivacy(bool on);                    // mask the money columns
    void applyTheme();

signals:
    // One specific position. The whole row is carried, not just its id: the
    // close dialog shows side, size and P/L, and re-deriving those from a
    // later poll could describe a position that has already moved.
    void closePosition(const OpenPosition& position);
    // Edit this position's stop loss / take profit.
    void modifyBrackets(const OpenPosition& position);
    // Share this position as a public card.
    void sharePosition(const OpenPosition& position);
    // Cancel a listed pending order.
    void cancelOrder(const PendingOrder& order);
    // Amend a listed pending order (price / volume / brackets).
    void modifyOrder(const PendingOrder& order);
    // An S/L or T/P cell was edited in place. level 0 removes that bracket.
    void bracketEdited(const QString& positionId, const QString& kind, double level);
    // The Comment cell was edited in place. An empty string clears it.
    void commentEdited(const QString& positionId, const QString& comment);
    // A column was switched on or off, so the set can be persisted.
    void columnsChanged(const QStringList& hiddenKeys);
    // Auto Arrange or Grid was flipped. Both travel together because both are
    // saved in the same place and neither is worth a signal of its own.
    void viewPrefsChanged(bool autoArrange, bool grid);

private slots:
    // Handles every in-place edit on the Trade table: the two bracket cells
    // and the comment. One slot because QTableWidget reports them all through
    // the same itemChanged signal.
    void onBracketEdited(class QTableWidgetItem* item);

private:
    // Time filter, one per tab. Which timestamp it tests depends on the tab:
    // open time for Trade/Pending, close time for History.
    // The order here IS the combo's order — each value is its index — so these
    // may be reordered only alongside the list in buildFilterBar().
    // Last month and Last 3 months are MetaTrader's own periods, added because
    // the desk asked for its History right-click menu and those two are on it.
    enum Range { RangeToday = 0, RangeWeek, RangeMonth, RangeQuarter, RangeAll, RangeDay };

    // Tests an API timestamp against tab `tab`'s filter. Rows whose timestamp
    // cannot be parsed always pass: hiding a real trade because of an
    // unexpected date format is far worse than showing one the filter should
    // have excluded.
    bool passes(int tab, const QString& iso) const;
    QWidget* buildFilterBar(int tab);

    // ── the right-click menu ──
    // The table behind a filtered tab: 0 Trade, 1 Pending, 2 History,
    // 3 Transactions. Null for anything else.
    QTableWidget* tableFor(int tab) const;
    // globalPos, not a viewport point: the same menu is raised from the table
    // AND from its header, and each maps its own coordinates.
    void openTableMenu(int tab, const QPoint& globalPos);
    // "<tab>/<header>". One place builds it so the menu, the saved set and the
    // applying pass can never spell a key three different ways.
    static QString colKey(int tab, const QString& header);
    // Columns a trader must not be able to lose: Symbol names the row and
    // Action holds its buttons, so hiding either breaks the tab rather than
    // tidying it.
    static bool columnIsFixed(const QString& header);
    void applyColumnVisibility();
    void applyHeaderMode();          // Auto Arrange
    void applyGrid();
    QWidget* wrapTable(int tab, QTableWidget* table);
    // Which slice of the ledger the Transactions tab shows. Funding is money
    // in and out of the account; trading is what the account did with it.
    enum TxnKind { KindAll = 0, KindFunding, KindTrading };

    QWidget* buildHistorySummary();
    // The statement's markup, built from the rows the History tab is showing.
    QString historyReportHtml() const;
    void     refreshHistorySummary();

    QTabWidget*   m_tabs;
    NewsPanel*    m_news = nullptr;
    CalendarPanel* m_calendar = nullptr;
    // Tab positions, captured from addTab() instead of written as literals.
    // The counts in the captions used to be set with hardcoded indices, so
    // inserting the Calendar tab silently retitled it "Transactions (0)" and
    // left the real Transactions tab with a stale caption. Storing what
    // addTab() returns makes the order a detail of one place again.
    int m_tabTrade = 0, m_tabPending = 1, m_tabHistory = 2, m_tabTxn = 4;
    QTableWidget* m_posTable;
    QTableWidget* m_orderTable;
    QTableWidget* m_histTable;
    QTableWidget* m_txnTable;
    // One slot per FILTERED tab: 0 Trade, 1 Pending, 2 History,
    // 3 Transactions. News and Calendar have no slot — News has no filter at
    // all, and the Calendar owns its own (impact + countries), which filter a
    // third-party embed rather than one of these tables.
    QComboBox*    m_range[4] = {nullptr, nullptr, nullptr, nullptr};
    QDateEdit*    m_date[4]  = {nullptr, nullptr, nullptr, nullptr};
    // True while a table is being filled. itemChanged() cannot tell a repaint
    // from a real edit on its own, and setPositions() runs every four seconds.
    bool m_populating = false;
    bool m_collapsed = false;
    bool m_privacy = false;

    // Right-click menu state. Defaults match how the blotter has always opened:
    // every column present, widths shared, grid on.
    QStringList m_hiddenCols;
    bool m_autoArrange = true;
    bool m_gridOn      = true;

    // Last snapshots, so a privacy/theme/filter change can re-render without a
    // poll. These always hold the UNFILTERED server data — filtering happens on
    // the way into the table, so widening the range never needs a refetch.
    QVector<OpenPosition> m_lastPositions;
    QVector<PendingOrder> m_lastOrders;
    QVector<HistoryTrade> m_lastHistory;
    QVector<Transaction>  m_lastTxns;
    AccountInfo           m_lastAccount;
    QString               m_traderName;

    // History summary — the closing figures MT5 puts under its History tab,
    // and the ones the desk asked for by name.
    QComboBox* m_txnKind    = nullptr;
    QWidget* m_histSummary  = nullptr;
    QLabel* m_sumProfit     = nullptr;
    QLabel* m_sumDeposit    = nullptr;
    QLabel* m_sumWithdrawal = nullptr;
    QLabel* m_sumBalance    = nullptr;

    // symbol -> decimals. Defaults to 5 for anything not listed, which is the
    // right guess for an FX pair and the old behaviour for everything else.
    QHash<QString, int> m_digits;
    int digitsFor(const QString& symbol) const { return m_digits.value(symbol, 5); }

    // ── Transactions pagination ──
    // The ledger is the one tab that can run to hundreds of rows in a blotter
    // only ~200px tall, so it pages rather than scrolls. 0-based; clamped in
    // setTransactions() because the filter can shrink the list under the page
    // the user is currently on.
    int          m_txnPage = 0;
    QComboBox*   m_txnPageSize = nullptr;
    QPushButton* m_txnPrev = nullptr;
    QPushButton* m_txnNext = nullptr;
    QLabel*      m_txnPageLbl = nullptr;
    int          txnPageSize() const;
};
