#pragma once
#include <QHash>
#include <QJSEngine>
#include <QJSValue>
#include <QObject>
#include <QString>
#include <QVariantList>
#include "core/Models.h"

class ApiClient;

// The object a trader's script talks to, exposed to JavaScript as `terminal`.
//
// Everything the script can see or do goes through here, which is the point:
// there is exactly one surface to audit, and it is the only way a script can
// reach the account. QJSEngine itself has no file, network or process access,
// so a script cannot do anything this class does not offer it.
//
// Prices, positions and the account are PUSHED in rather than fetched. The
// terminal is already polling all three for the blotter, and a script that
// triggered its own requests would both double the traffic and be able to see
// a different market from the one on screen.
class ScriptApi : public QObject {
    Q_OBJECT
public:
    explicit ScriptApi(ApiClient* api, QObject* parent = nullptr);

    // Fed by the window while a script is running.
    void setQuotes(const QHash<QString, Quote>& quotes);
    void setAccount(const AccountInfo& account);
    void setPositions(const QVector<OpenPosition>& positions);
    void setSymbols(const QStringList& symbols);

    // Simulation mode. ON by default, and the dialog makes the trader turn it
    // off deliberately: a script is code someone wrote in a text box minutes
    // ago, and the account it would trade is real money. Simulated orders are
    // logged exactly as they would be placed, and nothing is sent.
    void setSimulated(bool on) { m_simulated = on; }
    bool simulated() const { return m_simulated; }

    // Count of orders the last run actually sent (0 while simulating), so the
    // dialog can say what happened rather than implying nothing did.
    int ordersPlaced() const { return m_ordersPlaced; }
    void resetCounters() { m_ordersPlaced = 0; }

    // ── the script-facing API ──
    Q_INVOKABLE void log(const QString& message);
    Q_INVOKABLE QStringList symbols() const;
    Q_INVOKABLE double bid(const QString& symbol) const;
    Q_INVOKABLE double ask(const QString& symbol) const;
    Q_INVOKABLE double spread(const QString& symbol) const;
    Q_INVOKABLE bool   hasPrice(const QString& symbol) const;

    Q_INVOKABLE double balance() const;
    Q_INVOKABLE double equity() const;
    Q_INVOKABLE double freeMargin() const;
    Q_INVOKABLE QString currency() const;

    // [{id, symbol, side, lots, openPrice, profit, stopLoss, takeProfit}, …]
    Q_INVOKABLE QVariantList positions() const;

    // Market orders. stopLoss / takeProfit of 0 mean "none", which is how the
    // rest of the terminal spells it. Returns false and logs the reason when
    // the order is refused before it is sent.
    Q_INVOKABLE bool buy(const QString& symbol, double lots,
                         double stopLoss = 0.0, double takeProfit = 0.0,
                         const QString& comment = QString());
    Q_INVOKABLE bool sell(const QString& symbol, double lots,
                          double stopLoss = 0.0, double takeProfit = 0.0,
                          const QString& comment = QString());
    // Closes every open position on one instrument — the only close the algo
    // endpoint offers, so the API does not pretend a per-position one exists.
    Q_INVOKABLE bool closeAll(const QString& symbol);

signals:
    // Script output and engine messages, for the dialog's log pane.
    void logged(const QString& line);

private:
    bool placeOrder(const QString& side, const QString& symbol, double lots,
                    double stopLoss, double takeProfit, const QString& comment);

    ApiClient* m_api;
    QHash<QString, Quote>  m_quotes;
    AccountInfo            m_account;
    QVector<OpenPosition>  m_positions;
    QStringList            m_symbols;
    bool m_simulated = true;
    int  m_ordersPlaced = 0;
};

// Runs one script.
//
// Two shapes, matching what MetaTrader means by each:
//
//   • a SCRIPT runs top to bottom once and is done;
//   • a script that also defines onTick(quote) keeps running, and that function
//     is called for every tick until the trader stops it.
//
// The second is how "Stop" becomes meaningful for something that would
// otherwise already have finished, and it is the shape a strategy needs.
class ScriptEngine : public QObject {
    Q_OBJECT
public:
    explicit ScriptEngine(ApiClient* api, QObject* parent = nullptr);

    ScriptApi* api() const { return m_api; }

    // Syntax check only — nothing is executed. This is what Insert > Scripts >
    // Compile does, and what Run does first so a typo never half-runs.
    // Returns true when the source parses; `error` carries the message if not.
    static bool checkSyntax(const QString& source, QString* error, int* line);

    // Runs the script's top level. Returns false if it threw; the message goes
    // to the log either way.
    bool run(const QString& source);
    // True once run() has completed AND the script defined onTick, meaning it
    // is still live and wants ticks.
    bool isLive() const { return m_live; }
    // Hands one tick to the script's onTick. A throw stops the script rather
    // than repeating the same error on every tick for the rest of the session.
    void deliverTick(const Quote& q);
    // Stops a live script, and interrupts one that is mid-execution — a script
    // with a runaway loop cannot be stopped any other way.
    void stop();

signals:
    void logged(const QString& line);
    // Raised when the script stops on its own: it threw, or it never asked for
    // ticks. The dialog uses it to put the buttons back.
    void finished(bool ok);

private:
    void report(const QJSValue& result, const QString& what);

    QJSEngine  m_engine;
    ScriptApi* m_api;
    QJSValue   m_onTick;
    bool       m_live = false;
};
