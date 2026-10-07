#pragma once
#include <QJSEngine>
#include <QJSValue>
#include <QObject>
#include <QString>
#include <QVector>
#include "core/Models.h"

// View > Strategy Tester — runs a script over historical bars.
//
// The same JavaScript a script is written in, so a strategy can be tested here
// and then run live from Insert > Scripts without being rewritten. Instead of
// onTick, a strategy defines onBar(bar):
//
//     function onBar(bar) {
//       if (!strategy.position() && bar.close > bar.open) strategy.buy(0.10);
//       if (strategy.position() && bar.close < bar.open)  strategy.close();
//     }
//
// What this models, stated plainly, because a backtest that hides its
// assumptions is worse than none:
//
//   • ONE position at a time — long, short, or flat. A strategy calling buy()
//     while already long is told no rather than silently averaging in.
//   • Fills happen at the CLOSE of the bar the decision was made on, with the
//     spread paid on entry and exit. There is no intrabar fill and no slippage
//     model, so results are optimistic against a fast market.
//   • Stop loss and take profit are checked against the next bars' high and
//     low. When a bar's range covers BOTH, the stop is taken — the worst case,
//     because the bar does not say which came first.
//   • Commission is charged per lot per side.
//
// Results come back as HistoryTrade records, the same type the blotter and the
// Reports tables already use, so the statistics are computed by exactly the
// code that computes them for real trading.
class StrategyTester : public QObject {
    Q_OBJECT
public:
    struct Settings {
        QString symbol;
        QString timeframe = QStringLiteral("1h");
        double  startingBalance = 10000.0;
        // Spread in POINTS, the unit Market Watch shows it in. Converted with
        // the instrument's digits.
        double  spreadPoints = 0.0;
        int     digits = 5;
        double  commissionPerLot = 0.0;
        double  contractSize = 100000.0;
    };

    struct Result {
        bool    ok = false;
        QString error;                 // empty when ok
        QVector<HistoryTrade> trades;  // closed trades, in order
        QVector<double> equity;        // balance after each bar
        int     barsTested = 0;
        double  startingBalance = 0.0;
        double  finalBalance = 0.0;
    };

    explicit StrategyTester(QObject* parent = nullptr);

    // Runs `source` over `bars`, oldest first. Never touches the network or the
    // real account: this class has no ApiClient and cannot get one.
    Result run(const QString& source, const QVector<Bar>& bars,
               const Settings& settings);

signals:
    void logged(const QString& line);
};

// The object a strategy talks to, exposed as `strategy`. Lives in the header so
// the tester can own one; nothing else should construct it.
class BacktestApi : public QObject {
    Q_OBJECT
public:
    explicit BacktestApi(QObject* parent = nullptr);

    Q_INVOKABLE void log(const QString& message);
    // Opens a position at the current bar's close. Refused, with a logged
    // reason, when one is already open or the volume is not positive.
    Q_INVOKABLE bool buy(double lots, double stopLoss = 0.0, double takeProfit = 0.0);
    Q_INVOKABLE bool sell(double lots, double stopLoss = 0.0, double takeProfit = 0.0);
    // Closes the open position at the current bar's close. False when flat.
    Q_INVOKABLE bool close();
    // {side, lots, openPrice, stopLoss, takeProfit, profit} or null when flat.
    Q_INVOKABLE QJSValue position() const;
    Q_INVOKABLE double balance() const;
    Q_INVOKABLE double equity() const;

signals:
    void logged(const QString& line);

private:
    friend class StrategyTester;

    struct Open {
        bool    active = false;
        QString side;              // "buy" | "sell"
        double  lots = 0.0;
        double  openPrice = 0.0;
        double  stopLoss = 0.0, takeProfit = 0.0;
        QDateTime openedAt;
    };

    // Set by the tester before each onBar call.
    void setBar(const Bar& bar, int index);
    // Marks the open position to the current bar and returns its running P/L.
    double openProfit() const;
    // Closes at `price` for `reason`, appends the trade and credits the
    // balance. Used by close(), by the stop/target sweep and by the final
    // liquidation at the end of the data.
    void   closeAt(double price, const QString& reason, const QDateTime& when);
    double pipValue() const { return m_settings.contractSize; }

    StrategyTester::Settings m_settings;
    QJSEngine* m_engine = nullptr;     // for building the position object
    Bar    m_bar;
    int    m_index = 0;
    double m_balance = 0.0;
    Open   m_open;
    QVector<HistoryTrade> m_trades;
};
