#include "core/ScriptEngine.h"
#include "core/ApiClient.h"

#include <QVariantMap>

// ── ScriptApi ───────────────────────────────────────────────────────────────

ScriptApi::ScriptApi(ApiClient* api, QObject* parent)
    : QObject(parent), m_api(api) {}

void ScriptApi::setQuotes(const QHash<QString, Quote>& quotes) { m_quotes = quotes; }
void ScriptApi::setAccount(const AccountInfo& account)         { m_account = account; }
void ScriptApi::setPositions(const QVector<OpenPosition>& p)   { m_positions = p; }
void ScriptApi::setSymbols(const QStringList& symbols)         { m_symbols = symbols; }

void ScriptApi::log(const QString& message) {
    emit logged(message);
}

QStringList ScriptApi::symbols() const { return m_symbols; }

double ScriptApi::bid(const QString& symbol) const {
    return m_quotes.value(symbol.toUpper()).bid;
}
double ScriptApi::ask(const QString& symbol) const {
    return m_quotes.value(symbol.toUpper()).ask;
}
double ScriptApi::spread(const QString& symbol) const {
    return m_quotes.value(symbol.toUpper()).spread;
}
bool ScriptApi::hasPrice(const QString& symbol) const {
    const Quote q = m_quotes.value(symbol.toUpper());
    return q.valid && q.bid > 0.0;
}

double  ScriptApi::balance()    const { return m_account.balance; }
double  ScriptApi::equity()     const { return m_account.equity; }
double  ScriptApi::freeMargin() const { return m_account.freeMargin; }
QString ScriptApi::currency()   const { return m_account.currency; }

QVariantList ScriptApi::positions() const {
    QVariantList out;
    for (const OpenPosition& p : m_positions) {
        QVariantMap m;
        m["id"]         = p.id;
        m["symbol"]     = p.symbol;
        m["side"]       = p.side;
        m["lots"]       = p.lots;
        m["openPrice"]  = p.openPrice;
        m["price"]      = p.currentPrice;
        m["stopLoss"]   = p.sl;
        m["takeProfit"] = p.tp;
        m["profit"]     = p.profit;
        m["comment"]    = p.comment;
        out.append(m);
    }
    return out;
}

bool ScriptApi::buy(const QString& symbol, double lots, double sl, double tp,
                    const QString& comment) {
    return placeOrder(QStringLiteral("BUY"), symbol, lots, sl, tp, comment);
}

bool ScriptApi::sell(const QString& symbol, double lots, double sl, double tp,
                     const QString& comment) {
    return placeOrder(QStringLiteral("SELL"), symbol, lots, sl, tp, comment);
}

bool ScriptApi::placeOrder(const QString& side, const QString& symbol, double lots,
                           double sl, double tp, const QString& comment) {
    const QString sym = symbol.trimmed().toUpper();

    // Checked here rather than left to the server. A script loops, and a loop
    // that fires a malformed order on every tick would be a few hundred
    // rejected requests before anyone noticed.
    if (sym.isEmpty()) {
        emit logged(QStringLiteral("✕ order refused: no symbol"));
        return false;
    }
    if (!(lots > 0.0)) {
        emit logged(QString("✕ %1 %2 refused: volume must be greater than zero")
                        .arg(side, sym));
        return false;
    }
    if (!hasPrice(sym)) {
        emit logged(QString("✕ %1 %2 refused: no live price for that instrument")
                        .arg(side, sym));
        return false;
    }

    const QString line = QString("%1 %2 %L3 lots%4%5")
        .arg(side, sym).arg(lots, 0, 'f', 2)
        .arg(sl > 0.0 ? QString(", SL %1").arg(sl, 0, 'f', 5) : QString())
        .arg(tp > 0.0 ? QString(", TP %1").arg(tp, 0, 'f', 5) : QString());

    if (m_simulated) {
        emit logged(QStringLiteral("· simulated: ") + line);
        return true;
    }

    emit logged(QStringLiteral("→ sent: ") + line);
    m_api->placeOrder(side, sym, lots, sl, tp, comment);
    ++m_ordersPlaced;
    return true;
}

bool ScriptApi::closeAll(const QString& symbol) {
    const QString sym = symbol.trimmed().toUpper();
    if (sym.isEmpty()) {
        emit logged(QStringLiteral("✕ close refused: no symbol"));
        return false;
    }
    if (m_simulated) {
        emit logged(QString("· simulated: close all %1").arg(sym));
        return true;
    }
    emit logged(QString("→ sent: close all %1").arg(sym));
    m_api->closePositions(sym);
    ++m_ordersPlaced;
    return true;
}

// ── ScriptEngine ────────────────────────────────────────────────────────────

ScriptEngine::ScriptEngine(ApiClient* api, QObject* parent)
    : QObject(parent), m_api(new ScriptApi(api, this)) {
    connect(m_api, &ScriptApi::logged, this, &ScriptEngine::logged);

    // `terminal` is the ONLY global the script gets beyond JavaScript's own.
    // QJSEngine installs no file, network or process bindings of its own, so
    // this object is the whole of a script's reach.
    m_engine.globalObject().setProperty(QStringLiteral("terminal"),
                                        m_engine.newQObject(m_api));

    // console.log is what everyone reaches for first; point it at the same log
    // rather than letting it silently do nothing.
    QJSValue console = m_engine.newObject();
    console.setProperty(QStringLiteral("log"),
                        m_engine.evaluate(QStringLiteral(
                            "(function() { terminal.log("
                            "  Array.prototype.slice.call(arguments).join(' ')); })")));
    m_engine.globalObject().setProperty(QStringLiteral("console"), console);
}

bool ScriptEngine::checkSyntax(const QString& source, QString* error, int* line) {
    // A throwaway engine, and the program is never called — newing it up costs
    // nothing next to being certain nothing ran.
    QJSEngine probe;
    const QJSValue program = probe.evaluate(
        QString("(function(){\n%1\n})").arg(source));
    if (!program.isError()) return true;
    if (error) *error = program.property(QStringLiteral("message")).toString();
    // Offset by the wrapper's first line so the number points at the trader's
    // own source rather than one line below it.
    if (line) *line = program.property(QStringLiteral("lineNumber")).toInt() - 1;
    return false;
}

void ScriptEngine::report(const QJSValue& result, const QString& what) {
    if (!result.isError()) return;
    emit logged(QString("✕ %1 failed at line %2: %3")
                    .arg(what)
                    .arg(result.property(QStringLiteral("lineNumber")).toInt())
                    .arg(result.property(QStringLiteral("message")).toString()));
}

bool ScriptEngine::run(const QString& source) {
    m_live = false;
    m_onTick = QJSValue();
    m_api->resetCounters();
    m_engine.setInterrupted(false);

    const QJSValue result = m_engine.evaluate(source);
    if (result.isError()) {
        report(result, tr("script"));
        emit finished(false);
        return false;
    }

    // A script that defined onTick wants to keep running. One that did not has
    // already done its work and is finished — which is exactly MetaTrader's
    // distinction between a script and an expert advisor.
    const QJSValue onTick = m_engine.globalObject().property(QStringLiteral("onTick"));
    if (onTick.isCallable()) {
        m_onTick = onTick;
        m_live = true;
        emit logged(tr("Script is live — onTick will run on every price update."));
        return true;
    }

    emit logged(tr("Script finished."));
    emit finished(true);
    return true;
}

void ScriptEngine::deliverTick(const Quote& q) {
    if (!m_live || !m_onTick.isCallable()) return;

    QJSValue tick = m_engine.newObject();
    tick.setProperty(QStringLiteral("symbol"), q.symbol);
    tick.setProperty(QStringLiteral("bid"), q.bid);
    tick.setProperty(QStringLiteral("ask"), q.ask);
    tick.setProperty(QStringLiteral("spread"), q.spread);

    const QJSValue result = m_onTick.call({tick});
    if (!result.isError()) return;

    // Stop on the first throw. A strategy that fails on one tick will fail on
    // the next, and a log filling at tick rate hides the error that caused it.
    report(result, tr("onTick"));
    emit logged(tr("Script stopped after the error above."));
    m_live = false;
    m_onTick = QJSValue();
    emit finished(false);
}

void ScriptEngine::stop() {
    // setInterrupted unwinds a script that is executing right now — the only
    // way out of `while (true) {}`, which a trader will eventually write.
    m_engine.setInterrupted(true);
    const bool wasLive = m_live;
    m_live = false;
    m_onTick = QJSValue();
    if (wasLive) {
        emit logged(tr("Script stopped."));
        emit finished(true);
    }
}
