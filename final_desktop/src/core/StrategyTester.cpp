#include "core/StrategyTester.h"

#include <QtMath>

// ── BacktestApi ─────────────────────────────────────────────────────────────

BacktestApi::BacktestApi(QObject* parent) : QObject(parent) {}

void BacktestApi::log(const QString& message) {
    emit logged(message);
}

void BacktestApi::setBar(const Bar& bar, int index) {
    m_bar = bar;
    m_index = index;
}

double BacktestApi::openProfit() const {
    if (!m_open.active) return 0.0;
    // Marked at the bar's close, on the side the position would exit at. The
    // spread is charged once, on exit, because it was already paid on entry
    // through the entry price.
    const double spread = m_settings.spreadPoints * std::pow(10.0, -(m_settings.digits - 1));
    const double exit = m_open.side == QLatin1String("buy") ? m_bar.close - spread / 2.0
                                                            : m_bar.close + spread / 2.0;
    const double move = m_open.side == QLatin1String("buy") ? exit - m_open.openPrice
                                                            : m_open.openPrice - exit;
    return move * m_open.lots * m_settings.contractSize;
}

bool BacktestApi::buy(double lots, double sl, double tp) {
    if (m_open.active) {
        emit logged(QStringLiteral("✕ buy refused: a position is already open"));
        return false;
    }
    if (!(lots > 0.0)) {
        emit logged(QStringLiteral("✕ buy refused: volume must be greater than zero"));
        return false;
    }
    const double spread = m_settings.spreadPoints * std::pow(10.0, -(m_settings.digits - 1));
    m_open = Open{true, QStringLiteral("buy"), lots,
                  m_bar.close + spread / 2.0,   // a buy fills at the ask
                  sl, tp, m_bar.time};
    return true;
}

bool BacktestApi::sell(double lots, double sl, double tp) {
    if (m_open.active) {
        emit logged(QStringLiteral("✕ sell refused: a position is already open"));
        return false;
    }
    if (!(lots > 0.0)) {
        emit logged(QStringLiteral("✕ sell refused: volume must be greater than zero"));
        return false;
    }
    const double spread = m_settings.spreadPoints * std::pow(10.0, -(m_settings.digits - 1));
    m_open = Open{true, QStringLiteral("sell"), lots,
                  m_bar.close - spread / 2.0,   // a sell fills at the bid
                  sl, tp, m_bar.time};
    return true;
}

bool BacktestApi::close() {
    if (!m_open.active) return false;
    const double spread = m_settings.spreadPoints * std::pow(10.0, -(m_settings.digits - 1));
    const double exit = m_open.side == QLatin1String("buy") ? m_bar.close - spread / 2.0
                                                            : m_bar.close + spread / 2.0;
    closeAt(exit, QStringLiteral("strategy"), m_bar.time);
    return true;
}

void BacktestApi::closeAt(double price, const QString& reason, const QDateTime& when) {
    if (!m_open.active) return;

    const double move = m_open.side == QLatin1String("buy") ? price - m_open.openPrice
                                                            : m_open.openPrice - price;
    const double gross = move * m_open.lots * m_settings.contractSize;
    // Per lot per side, which is how the platform charges it. Recorded negative
    // so the report's `profit + swap + commission` arithmetic is the same here
    // as it is for a real trade.
    const double commission = -m_settings.commissionPerLot * m_open.lots * 2.0;

    HistoryTrade t;
    t.symbol      = m_settings.symbol;
    t.side        = m_open.side;
    t.lots        = m_open.lots;
    t.openPrice   = m_open.openPrice;
    t.closePrice  = price;
    t.profit      = gross;
    t.swap        = 0.0;        // not modelled: no overnight financing curve
    t.commission  = commission;
    t.openedAt    = m_open.openedAt.toUTC().toString(Qt::ISODate);
    t.closedAt    = when.toUTC().toString(Qt::ISODate);
    t.closeReason = reason;
    m_trades.append(t);

    m_balance += gross + commission;
    m_open = Open{};
}

QJSValue BacktestApi::position() const {
    if (!m_open.active || !m_engine) return QJSValue(QJSValue::NullValue);
    QJSValue o = m_engine->newObject();
    o.setProperty(QStringLiteral("side"), m_open.side);
    o.setProperty(QStringLiteral("lots"), m_open.lots);
    o.setProperty(QStringLiteral("openPrice"), m_open.openPrice);
    o.setProperty(QStringLiteral("stopLoss"), m_open.stopLoss);
    o.setProperty(QStringLiteral("takeProfit"), m_open.takeProfit);
    o.setProperty(QStringLiteral("profit"), openProfit());
    return o;
}

double BacktestApi::balance() const { return m_balance; }
double BacktestApi::equity()  const { return m_balance + openProfit(); }

// ── StrategyTester ──────────────────────────────────────────────────────────

StrategyTester::StrategyTester(QObject* parent) : QObject(parent) {}

StrategyTester::Result StrategyTester::run(const QString& source,
                                           const QVector<Bar>& bars,
                                           const Settings& settings) {
    Result r;
    r.startingBalance = settings.startingBalance;
    r.finalBalance    = settings.startingBalance;

    if (bars.isEmpty()) {
        r.error = tr("No historical bars for %1 — nothing to test against.")
                      .arg(settings.symbol);
        return r;
    }

    // Declaration order matters twice over.
    //
    // `api` is given a PARENT. QJSEngine::newQObject() takes JavaScript
    // ownership of a QObject that has none, so the engine would try to delete
    // this stack object when it collected the wrapper — a double free, and the
    // crash would land somewhere unrelated. A parented object is CppOwnership
    // and the engine leaves it alone.
    //
    // And `api` is declared BEFORE `engine`, so the engine is destroyed first:
    // locals go in reverse, and an engine outliving the object it wraps is the
    // same hazard from the other end.
    BacktestApi api(this);
    QJSEngine engine;
    api.m_settings = settings;
    api.m_engine   = &engine;
    api.m_balance  = settings.startingBalance;
    connect(&api, &BacktestApi::logged, this, &StrategyTester::logged);

    engine.globalObject().setProperty(QStringLiteral("strategy"),
                                      engine.newQObject(&api));
    // Same console.log shim as the live script engine, so a strategy moved
    // between the two behaves identically.
    QJSValue console = engine.newObject();
    console.setProperty(QStringLiteral("log"),
                        engine.evaluate(QStringLiteral(
                            "(function() { strategy.log("
                            "  Array.prototype.slice.call(arguments).join(' ')); })")));
    engine.globalObject().setProperty(QStringLiteral("console"), console);

    const QJSValue top = engine.evaluate(source);
    if (top.isError()) {
        r.error = tr("Line %1: %2")
                      .arg(top.property(QStringLiteral("lineNumber")).toInt())
                      .arg(top.property(QStringLiteral("message")).toString());
        return r;
    }

    QJSValue onBar = engine.globalObject().property(QStringLiteral("onBar"));
    if (!onBar.isCallable()) {
        r.error = tr("This script has no onBar(bar) function, so there is "
                     "nothing for the tester to call. A strategy needs one.");
        return r;
    }

    for (int i = 0; i < bars.size(); ++i) {
        const Bar& b = bars[i];
        api.setBar(b, i);

        // Stops and targets are swept BEFORE the strategy is asked about this
        // bar: a position that was going to be stopped out overnight must not
        // get to act on the new bar first.
        if (api.m_open.active) {
            const bool isBuy = api.m_open.side == QLatin1String("buy");
            const double sl = api.m_open.stopLoss;
            const double tp = api.m_open.takeProfit;
            const bool slHit = sl > 0.0 && (isBuy ? b.low <= sl : b.high >= sl);
            const bool tpHit = tp > 0.0 && (isBuy ? b.high >= tp : b.low <= tp);
            // Both inside one bar: take the stop. The bar does not record the
            // order its extremes happened in, and assuming the target would
            // flatter every strategy that uses both.
            if (slHit)      api.closeAt(sl, QStringLiteral("sl"), b.time);
            else if (tpHit) api.closeAt(tp, QStringLiteral("tp"), b.time);
        }

        QJSValue bar = engine.newObject();
        bar.setProperty(QStringLiteral("time"),   static_cast<double>(b.time.toSecsSinceEpoch()));
        bar.setProperty(QStringLiteral("open"),   b.open);
        bar.setProperty(QStringLiteral("high"),   b.high);
        bar.setProperty(QStringLiteral("low"),    b.low);
        bar.setProperty(QStringLiteral("close"),  b.close);
        bar.setProperty(QStringLiteral("volume"), b.volume);
        bar.setProperty(QStringLiteral("index"),  i);

        const QJSValue out = onBar.call({bar});
        if (out.isError()) {
            r.error = tr("onBar failed on bar %1 (line %2): %3")
                          .arg(i)
                          .arg(out.property(QStringLiteral("lineNumber")).toInt())
                          .arg(out.property(QStringLiteral("message")).toString());
            return r;
        }

        r.equity.append(api.equity());
        ++r.barsTested;
    }

    // Anything still open at the end of the data is closed at the last price.
    // Leaving it out would let a strategy hide its worst trade by never
    // closing it.
    if (api.m_open.active) {
        api.setBar(bars.last(), bars.size() - 1);
        api.close();
        emit logged(tr("Position still open at the end of the data — closed at "
                       "the last bar's close."));
    }

    r.ok           = true;
    r.trades       = api.m_trades;
    r.finalBalance = api.m_balance;
    return r;
}
