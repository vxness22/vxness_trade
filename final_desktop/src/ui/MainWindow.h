#pragma once
#include <QMainWindow>
#include <QHash>
#include <QIcon>
#include <QVector>
#include "core/Config.h"
#include "core/Models.h"

class ApiClient;
class PriceStream;
class WatchlistWidget;
class ChartArea;
class OrderTicket;
class AccountPanel;
class PositionsPanel;
class QLabel;
class QTimer;
class QMenu;
class QAction;
class QActionGroup;
class QSplitter;
class QFrame;
class QToolBar;

// MetaTrader-style shell:
//
//   ┌─ menu bar ─────────────────────────── account · connection ─┐
//   │ Market Watch │ chart (+ one-click strip floating on it)     │
//   │  Sym Bid Ask ├──────────────────────────────────────────────┤
//   │              │ Trade / Pending / History blotter            │
//   │              │ Balance: … Equity: … Margin: …               │
//   └─ status bar ────────────────────────────────────────────────┘
//
// The menu follows the desk's specification: File (order, workspace profiles,
// account and sign-in), Trade, Accounts, View (panels, then this terminal's own
// appearance settings) and Insert. Entries that name something not yet built
// say so when opened — see MainWindow::comingSoon — rather than being left off
// the menu or, worse, opening something that is not what they claim.
// Services stay off the UI: MainWindow owns ApiClient and PriceStream and
// connects their signals to the widgets.
class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    explicit MainWindow(const Config& cfg, QWidget* parent = nullptr);

private slots:
    void onSymbolsReceived(const QVector<SymbolSpec>& symbols);
    void onSymbolActivated(const QString& symbol);
    void onTradeResult(const TradeResult& r);
    void onApiError(const QString& context, const QString& message, int httpStatus);
    void openSettings();
    void openOrderWindow();    // Market + Pending order ticket (F9)
    // MT5's symbol Specification panel, from the Market Watch right-click.
    void openSpecification(const QString& symbol);
    // Same sheet, opened on top of another modal dialog. An application-modal
    // dialog only lets its OWN children through, so the Symbols browser has to
    // be the parent or the sheet it opens comes up blocked and unclickable.
    void openSpecificationOn(const QString& symbol, QWidget* parent);
    void onActiveChartChanged(int index);  // strip follows the active pane
    void persistChartLayout();             // grid + per-pane symbols -> Config
    void logout();              // clear the session and return to the sign-in card
    void applyTheme();          // restyle the bits that carry inline style sheets
    // ── File > Profile ──
    void saveProfileAs();                       // asks for a name, then captures
    void loadProfile(const QString& name);      // puts the workspace back
    void rebuildProfileMenu();                  // Load/Delete lists, on open
    // ── File > Open an Account ──
    void openAccountSignup();
    // ── View ──
    void openSymbolsBrowser();   // View > Symbols
    void openNavigation();       // View > Navigation
    // View > Reports, opened on one of ReportsDialog::Tab. Typed as int so the
    // header does not have to pull the dialog in.
    void openReports(int tab);
    // ── Insert > Scripts ──
    void openScripts();
    // ── View > Strategy Tester ──
    void openStrategyTester();
    // One place for the View entries the desk named but that do not exist yet
    // (Strategy Tester, and three of the four Reports). Says what is missing
    // rather than opening something that is not it.
    void comingSoon(const QString& feature);
    // ── File > Login to Web Service ──
    // The trading account signs in with email and password; the web service is
    // reached with the API key and secret the dashboard issues. Same dialog,
    // opened on its other mode.
    void openWebServiceLogin();

protected:
    // Remembers where the window was and whether it was maximized.
    void closeEvent(QCloseEvent* e) override;

private:
    void connectServices();
    void buildMenuBar();
    // The two rows under the menu, MetaTrader's Standard and Line Studies
    // toolbars. Runs AFTER buildMenuBar(): the buttons share that menu's
    // actions rather than owning a second copy of each, so a toggle flipped
    // from either place shows as flipped in both.
    void buildToolBars();
    // Toolbar icons are pixmaps, not style-sheet rules, so nothing repaints
    // them when the theme flips. Re-renders every one at the new colour.
    void restyleToolBars();
    void rebuildAccountsMenu();
    void setStatus(const QString& text, bool error = false);
    void toggleTheme();
    void togglePrivacy();
    // Moves the market-watch / chart boundary to exactly fit the columns the
    // watchlist is showing. Called when that set changes, so switching a
    // column on widens the panel rather than leaving the column half cut off.
    void fitWatchlistWidth();
    void refreshAll();
    // Queues every instrument for a day's-high/low fetch, for Market Watch's
    // High and Low columns. Drained a few at a time rather than fired at once:
    // this is one request per instrument and there are a couple of hundred of
    // them, and none is worth delaying a price or a position poll behind.
    void seedDailyRanges();
    // Starts/stops the JWT renewal timer from whatever is in m_cfg. Every
    // sign-in path has to call this: the access token dies after ~45 minutes,
    // and a session that never renews takes the wallet and per-position close
    // down with it.
    void applySessionRenewal();
    // True when this session holds a JWT. Everything on /api/v1 — per-position
    // close, S/L and T/P, pending orders, the wallet — needs one, and a session
    // signed in with a pasted API key never has it. Says so once, here, instead
    // of each call site firing a request that 401s with a message no trader can
    // act on. `what` names the action in the message.
    bool requireSession(const QString& what);
    void updateIdentity();      // the "name | type | account no." line by the logo
    // Money as text, or a mask when privacy mode is on.
    QString money(double v, const QString& currency = QString()) const;
    void switchAccount(const QString& accountId);
    // Everything a workspace profile records, read off the live window.
    struct WorkspaceProfile captureProfile(const QString& name) const;
    // True when the trade panel is showing. Read from the menu action rather
    // than the widget: the panel is collapsed, not hidden, so it is never
    // isHidden() even when it has been shut.
    bool tradePanelVisible() const;

    Config       m_cfg;
    ApiClient*   m_api;
    PriceStream* m_stream;

    WatchlistWidget* m_watch;
    ChartArea*       m_charts;   // 1 / 2 / 4 chart panes; the watchlist drives the active one
    OrderTicket*     m_ticket;
    AccountPanel*    m_account;
    PositionsPanel*  m_positions;

    QLabel*  m_message;
    QTimer*  m_accountTimer;
    QTimer*  m_rangeTimer = nullptr;    // drains m_rangeQueue
    QTimer*  m_rangeReseedTimer = nullptr;
    QStringList m_rangeQueue;           // instruments still awaiting a day's range
    QTimer*  m_sessionTimer = nullptr;   // renews the JWT before it lapses
    // One recovery attempt per failure episode. Without it an expired token
    // would loop: the poll 401s, that triggers a refresh, the refresh answers
    // and the next poll 401s again a second later.
    bool     m_authRecoveryTried = false;
    QLabel*  m_identity = nullptr;     // menu-bar left: name | type | account no.
    QMenu*   m_accountsMenu = nullptr;
    QMenu*   m_profileMenu  = nullptr;
    int      m_historyTick  = 0;        // history is refetched every 3rd poll  // File > Profile, rebuilt when opened
    QAction* m_darkAction   = nullptr;
    QAction* m_privacyAction = nullptr;
    QAction* m_bloterAction = nullptr;  // show/hide the trade blotter
    QAction* m_marketWatchAction = nullptr;
    QAction* m_dataWindowAction  = nullptr;
    // View > Navigation, kept alive between openings so the tree does not have
    // to be rebuilt and the trader's expanded sections survive.
    class NavigationDialog* m_navigation = nullptr;
    // Insert > Scripts. Kept alive once opened: a live script must keep running
    // while the trader is back on the charts, and closing the window only hides
    // it (after asking, if a script is still going).
    class ScriptsDialog* m_scripts = nullptr;
    // View > Strategy Tester. Kept so a test's results and settings survive
    // closing the window, which a trader does between runs.
    class StrategyTesterDialog* m_tester = nullptr;
    QActionGroup* m_layoutGroup = nullptr;  // 1 / 2 / 4 chart panes

    // ── the two toolbars ──
    QToolBar* m_stdBar  = nullptr;   // New Order, panels, tools
    QToolBar* m_drawBar = nullptr;   // drawing tools + M1…MN
    // The timeframe buttons, exclusive. Kept so the ACTIVE pane's timeframe can
    // move the highlight — the chart's own header changes it too.
    QActionGroup* m_tfGroup = nullptr;
    // The drawing tools, exclusive, so the armed one is visible. Not synced
    // back from the chart: the library disarms to its own cursor after a shape
    // is finished, and there is no event for it, so the row would lie. The
    // arrow button is how a trader says "done", exactly as in MetaTrader.
    QActionGroup* m_toolGroup = nullptr;
    // Every toolbar action paired with the function that draws its icon, so a
    // theme switch can re-render all of them at the new colour.
    using IconFn = QIcon (*)(const QColor&, int);
    QVector<QPair<QAction*, IconFn>> m_barIcons;
    // The saved grid is restored once, from the first symbols payload — panes
    // cannot be pointed at an instrument before its metadata exists. Symbols
    // can be re-fetched mid-session, hence the latch.
    bool m_chartLayoutRestored = false;
    QFrame*  m_identityDivider = nullptr;  // hairline before the first menu
    QSplitter* m_bodySplit  = nullptr;   // market watch | centre column
    QSplitter* m_centerSplit = nullptr;

    QHash<QString, SymbolSpec> m_specs;
    // Last tick per symbol, so the pending-order dialog can seed its price
    // and state the rule without waiting for a fresh quote.
    QHash<QString, Quote> m_lastQuotes;
    QString     m_currentSymbol;
    AccountInfo m_lastAccount;          // re-rendered when privacy/theme flips
    bool        m_streamLive = false;
};
