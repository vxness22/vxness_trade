#include "core/ApiClient.h"
#include "core/ApiError.h"
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkCookie>
#include <QUrl>
#include <QUrlQuery>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>

ApiClient::ApiClient(const Config& cfg, QObject* parent)
    : QObject(parent), m_cfg(cfg), m_net(new QNetworkAccessManager(this)) {}

QNetworkRequest ApiClient::makeRequest(const QString& path) const {
    QNetworkRequest req{QUrl(m_cfg.restBase + path)};
    // The /api/algo endpoints. A signed-in session sends its JWT plus the
    // account SELECTED ON SCREEN, which the Vxness gateway verifies belongs to
    // the user. The algo key is used only when there is no session — the
    // "Login to Web Service" API-key mode.
    //
    // It used to be the other way round: the key won whenever one was stored.
    // A key is minted for ONE account, so after switching accounts from the
    // Accounts menu the blotter showed the new account while every Buy, Sell
    // and Close-All, and the balance/margin line, still went to the account the
    // key was minted for. A retired key also could not be recovered from,
    // because the key kept winning over a perfectly good token.
    if (!m_cfg.token.isEmpty() && !m_cfg.accountId.isEmpty()) {
        req.setRawHeader("Authorization", ("Bearer " + m_cfg.token).toUtf8());
        req.setRawHeader("X-Account-Id",  m_cfg.accountId.toUtf8());
    } else if (!m_cfg.apiKey.isEmpty() && !m_cfg.apiSecret.isEmpty()) {
        req.setRawHeader("X-Api-Key",    m_cfg.apiKey.toUtf8());
        req.setRawHeader("X-Api-Secret", m_cfg.apiSecret.toUtf8());
    } else if (!m_cfg.token.isEmpty()) {
        req.setRawHeader("Authorization", ("Bearer " + m_cfg.token).toUtf8());
    }
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                     QNetworkRequest::NoLessSafeRedirectPolicy);
    return req;
}

QNetworkRequest ApiClient::v1Request(const QString& path) const {
    // The per-position modify/close endpoints live under /api/v1/positions and
    // authenticate the platform user via the JWT (ownership is derived from the
    // position). Reuse the algo REST base, swapping /api/algo -> /api/v1.
    QString base = m_cfg.restBase;
    base.replace("/api/algo", "/api/v1");
    QNetworkRequest req{QUrl(base + path)};
    if (!m_cfg.token.isEmpty())
        req.setRawHeader("Authorization", ("Bearer " + m_cfg.token).toUtf8());
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                     QNetworkRequest::NoLessSafeRedirectPolicy);
    return req;
}

// --- parsing helpers -------------------------------------------------------

static SymbolSpec parseSymbol(const QJsonObject& o) {
    SymbolSpec s;
    s.symbol       = o.value("symbol").toString();
    s.displayName  = o.value("display_name").toString(s.symbol);
    s.category     = o.value("category").toString();
    s.digits       = o.value("digits").toInt(5);
    s.minLot       = o.value("min_lot").toDouble(0.01);
    s.maxLot       = o.value("max_lot").toDouble(100.0);
    s.lotStep      = o.value("lot_step").toDouble(0.01);
    s.contractSize = o.value("contract_size").toDouble(100000.0);
    return s;
}

static Quote parseQuote(const QJsonObject& o) {
    Quote q;
    q.symbol = o.value("symbol").toString();
    q.bid    = o.value("bid").toDouble();
    q.ask    = o.value("ask").toDouble();
    q.spread = o.value("spread").toDouble();
    q.timestamp = QDateTime::fromString(o.value("timestamp").toString(), Qt::ISODateWithMs);
    q.valid  = !q.symbol.isEmpty();
    return q;
}

static AccountInfo parseAccount(const QJsonObject& o) {
    AccountInfo a;
    a.account       = o.value("account").toString();
    a.currency      = o.value("currency").toString("USD");
    a.leverage      = o.value("leverage").toInt(100);
    a.balance       = o.value("balance").toDouble();
    a.credit        = o.value("credit").toDouble();
    a.equity        = o.value("equity").toDouble();
    a.marginUsed    = o.value("margin_used").toDouble();
    a.freeMargin    = o.value("free_margin").toDouble();
    a.marginLevel   = o.value("margin_level").toDouble();
    a.isDemo        = o.value("is_demo").toBool();
    a.openPositions = o.value("open_positions").toInt();
    a.valid         = !a.account.isEmpty();
    return a;
}

static Bar parseBar(const QJsonObject& o) {
    Bar b;
    b.time   = QDateTime::fromString(o.value("time").toString(), Qt::ISODateWithMs);
    b.open   = o.value("open").toDouble();
    b.high   = o.value("high").toDouble();
    b.low    = o.value("low").toDouble();
    b.close  = o.value("close").toDouble();
    b.volume = o.value("volume").toDouble();
    return b;
}

// The two gateways spell several fields differently (the algo connector used
// sl/tp/opened_at/profit; the platform API uses stop_loss/take_profit/
// created_at/pnl). Read whichever is present so one build works against both.
static QString firstString(const QJsonObject& o, std::initializer_list<const char*> keys) {
    for (const char* k : keys)
        if (o.contains(k) && !o.value(k).isNull()) return o.value(k).toString();
    return {};
}
static double firstDouble(const QJsonObject& o, std::initializer_list<const char*> keys) {
    for (const char* k : keys)
        if (o.contains(k) && !o.value(k).isNull()) return o.value(k).toDouble();
    return 0.0;
}

static OpenPosition parsePosition(const QJsonObject& o) {
    OpenPosition p;
    p.id           = o.value("id").toString();
    p.symbol       = o.value("symbol").toString();
    p.side         = o.value("side").toString();
    p.lots         = o.value("lots").toDouble();
    p.openPrice    = firstDouble(o, {"open_price"});
    p.currentPrice = firstDouble(o, {"current_price"});
    p.sl           = firstDouble(o, {"sl", "stop_loss"});
    p.tp           = firstDouble(o, {"tp", "take_profit"});
    // The terminal reads swap and commission SIGNED — a cost is negative — and
    // every total it shows is profit + swap + commission. The Vxness API sends
    // both as positive costs, so they are negated here, once, rather than in
    // each screen. The position's profit is already the server's floating P&L.
    p.swap         = -o.value("swap").toDouble();
    p.commission   = -o.value("commission").toDouble();
    p.profit       = firstDouble(o, {"profit", "pnl"});
    p.openedAt     = firstString(o, {"opened_at", "created_at"});
    p.comment      = o.value("comment").toString();
    const double q2u = o.value("quote_to_usd").toDouble();
    p.quoteToUsd   = q2u > 0 ? q2u : 1.0;
    p.markBid      = o.value("mark_bid").toDouble();
    return p;
}

static PendingOrder parseOrder(const QJsonObject& o) {
    PendingOrder p;
    p.id        = o.value("id").toString();
    p.symbol    = o.value("symbol").toString();
    p.type      = firstString(o, {"type", "order_type"});
    p.side      = o.value("side").toString();
    p.lots      = o.value("lots").toDouble();
    p.price     = firstDouble(o, {"price"});
    p.sl        = firstDouble(o, {"sl", "stop_loss"});
    p.tp        = firstDouble(o, {"tp", "take_profit"});
    p.createdAt = firstString(o, {"created_at"});
    p.comment   = o.value("comment").toString();
    p.status    = o.value("status").toString();
    return p;
}

static Transaction parseTransaction(const QJsonObject& o) {
    Transaction t;
    t.id          = o.value("id").toString();
    t.type        = o.value("type").toString();
    t.method      = o.value("method").toString();
    t.description = o.value("description").toString();
    t.currency    = o.value("currency").toString("USD");
    t.amount      = o.value("amount").toDouble();
    t.createdAt   = firstString(o, {"created_at"});
    return t;
}

static HistoryTrade parseHistory(const QJsonObject& o) {
    HistoryTrade h;
    h.id          = o.value("id").toString();
    h.symbol      = o.value("symbol").toString();
    h.side        = o.value("side").toString();
    h.lots        = o.value("lots").toDouble();
    h.openPrice   = firstDouble(o, {"open_price"});
    h.closePrice  = firstDouble(o, {"close_price"});
    // Same signed convention as parsePosition. The server's `profit` is the
    // realized P&L, which is ALREADY net of swap (and of any close commission);
    // `commission` is the open commission, a positive cost. Translated so that
    // profit + swap + commission — what the History total, the statement and
    // the Reports all add up — equals realized − open commission, the trade's
    // real effect on the balance. Read raw, that sum added the swap back a
    // second time and counted the commission as income.
    const double serverSwap = o.value("swap").toDouble();
    h.profit      = firstDouble(o, {"profit", "pnl"}) + serverSwap;
    h.swap        = -serverSwap;
    h.commission  = -o.value("commission").toDouble();
    h.sl          = firstDouble(o, {"sl", "stop_loss"});
    h.tp          = firstDouble(o, {"tp", "take_profit"});
    h.openedAt    = firstString(o, {"opened_at"});
    h.closedAt    = firstString(o, {"closed_at", "close_time"});
    h.closeReason = o.value("close_reason").toString();
    h.comment     = o.value("comment").toString();
    return h;
}

// --- requests --------------------------------------------------------------

void ApiClient::fetchSymbols() {
    QNetworkReply* r = m_net->get(makeRequest("/symbols"));
    handleReply(r, "symbols", tr("Loading symbols"));
}

void ApiClient::fetchAccount() {
    QNetworkReply* r = m_net->get(makeRequest("/account"));
    handleReply(r, "account", tr("Loading account"));
}

void ApiClient::fetchPrices(const QStringList& symbols) {
    QString path = "/prices";
    if (!symbols.isEmpty()) {
        QUrlQuery q;
        q.addQueryItem("symbols", symbols.join(','));
        path += "?" + q.toString();
    }
    QNetworkReply* r = m_net->get(makeRequest(path));
    handleReply(r, "prices", tr("Loading prices"));
}

void ApiClient::fetchBars(const QString& symbol, const QString& timeframe, int limit,
                          qint64 toSec, const QString& tag) {
    QUrlQuery q;
    q.addQueryItem("symbol", symbol);
    q.addQueryItem("timeframe", timeframe);
    q.addQueryItem("limit", QString::number(limit));
    if (toSec > 0)       q.addQueryItem("to", QString::number(toSec));
    if (!tag.isEmpty())  q.addQueryItem("tag", tag);
    QNetworkReply* r = m_net->get(makeRequest("/bars?" + q.toString()));
    handleReply(r, "bars", tr("Loading chart for %1").arg(symbol));
}

// Open positions, pending orders and closed-trade history are NOT part of the
// algo gateway — it only serves symbols/price/prices/bars/account/trade. They
// live on the platform API under /api/v1, keyed by account_id and authenticated
// with the user's JWT, which is why the blotter stayed empty while the chart
// worked. Trades placed from the website land in the same tables, so this is
// also what makes them visible here.
void ApiClient::fetchPositions() {
    if (m_cfg.accountId.isEmpty()) return;
    QNetworkReply* r = m_net->get(v1Request(
        QString("/positions/?account_id=%1&status=open").arg(m_cfg.accountId)));
    handleReply(r, "positions", tr("Loading positions"));
}

void ApiClient::fetchTransactions() {
    if (m_cfg.accountId.isEmpty()) return;
    // Scoped to the selected account. Without account_id the endpoint returns
    // the USER's whole ledger across every account, which is not what a
    // per-account blotter tab should show.
    QNetworkReply* r = m_net->get(
        v1Request("/wallet/transactions?account_id=" + m_cfg.accountId));
    handleReply(r, "transactions", tr("Loading transactions"));
}

// The Market Watch's specification panel. This is the platform's public
// trading catalog (/api/v1/trading/instruments/{symbol}), not the algo
// gateway: the algo /symbols list is deliberately thin — enough to size an
// order — while the catalog carries the pip size, the configured spread,
// commission per lot and the overnight swaps a trader opens the panel to read.
//
// It answers through its own handler rather than handleReply() so a failed
// lookup reaches the panel that asked instead of the status bar. A dialog the
// trader has open should explain its own blank fields.
void ApiClient::fetchInstrumentSpec(const QString& symbol) {
    if (symbol.trimmed().isEmpty()) return;
    const QString sym = symbol.toUpper();
    // Scoped to the selected account: spread, commission and swaps are set per
    // account type, so the panel states what an order on THIS account pays.
    QString path = "/trading/instruments/" + sym;
    if (!m_cfg.accountId.isEmpty()) path += "?account_id=" + m_cfg.accountId;
    QNetworkReply* r = m_net->get(v1Request(path));
    connect(r, &QNetworkReply::finished, this, [this, r, sym]() {
        r->deleteLater();
        const int http = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QJsonObject o = QJsonDocument::fromJson(r->readAll()).object();

        InstrumentSpec s;
        s.symbol = sym;
        if (r->error() != QNetworkReply::NoError || http >= 400) {
            s.error = apiDetail(o, r->errorString());
            emit instrumentSpecReceived(s);
            return;
        }

        s.symbol       = o.value("symbol").toString(sym);
        s.displayName  = o.value("display_name").toString();
        s.segment      = o.value("segment").toString();
        s.digits       = o.value("digits").toInt(5);
        s.pipSize      = o.value("pip_size").toDouble();
        s.minLot       = o.value("min_lot").toDouble();
        s.maxLot       = o.value("max_lot").toDouble();
        s.contractSize = o.value("contract_size").toDouble();

        const QJsonObject sp = o.value("spread").toObject();
        s.spreadType  = sp.value("type").toString();
        s.spreadValue = sp.value("value").toDouble();
        s.priceImpact = sp.value("price_impact").toDouble();

        s.commissionPerLot = o.value("commission_preview_per_lot").toDouble();
        // null means no swap has been configured, which is not the same as a
        // zero rate — see InstrumentSpec::hasSwaps.
        const QJsonValue sl = o.value("swap_long");
        const QJsonValue ss = o.value("swap_short");
        s.hasSwaps  = !sl.isNull() && !sl.isUndefined();
        s.swapLong  = sl.toDouble();
        s.swapShort = ss.toDouble();
        s.swapFree  = o.value("swap_free").toBool();
        s.valid     = true;
        emit instrumentSpecReceived(s);
    });
}

// The day's range for one instrument, for Market Watch's High / Low columns.
//
// This is the /bars endpoint, but on its own reply handler rather than through
// handleReply()'s "bars" kind. ChartBridge answers the chart's requestBars()
// off barsReceived and pops one entry from its pending queue per reply, so a
// one-bar range request fired while a chart happened to be loading the same
// symbol and timeframe would be handed to the chart instead — a thousand-bar
// history silently truncated to a single candle.
void ApiClient::fetchDailyRange(const QString& symbol) {
    if (symbol.trimmed().isEmpty()) return;
    const QString sym = symbol.toUpper();
    QUrlQuery q;
    q.addQueryItem("symbol", sym);
    q.addQueryItem("timeframe", "1d");
    q.addQueryItem("limit", "1");
    QNetworkReply* r = m_net->get(makeRequest("/bars?" + q.toString()));
    connect(r, &QNetworkReply::finished, this, [this, r, sym]() {
        r->deleteLater();
        const int http = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (r->error() != QNetworkReply::NoError || http >= 400) return;
        const QJsonArray bars = QJsonDocument::fromJson(r->readAll())
                                    .object().value("bars").toArray();
        if (bars.isEmpty()) return;   // no history for this instrument yet
        // Newest first, so the current day is the first entry.
        const Bar b = parseBar(bars.first().toObject());
        if (b.high <= 0.0 || b.low <= 0.0) return;
        emit dailyRangeReceived(sym, b.high, b.low, b.open);
    });
}

void ApiClient::fetchOrders() {
    if (m_cfg.accountId.isEmpty()) return;
    // status=pending, like fetchPositions asks for status=open. Without it the
    // endpoint returns EVERY order the account ever placed — filled market
    // orders included — and they all landed in the Pending tab, where the only
    // action offered is cancel. The server then rightly answered "Can only
    // cancel pending order" on each one.
    QNetworkReply* r = m_net->get(v1Request(
        QString("/orders/?account_id=%1&status=pending").arg(m_cfg.accountId)));
    handleReply(r, "orders", tr("Loading orders"));
}

void ApiClient::fetchHistory(int limit) {
    if (m_cfg.accountId.isEmpty()) return;
    QNetworkReply* r = m_net->get(v1Request(
        QString("/portfolio/trades?account_id=%1&per_page=%2").arg(m_cfg.accountId).arg(limit)));
    handleReply(r, "history", tr("Loading history"));
}

void ApiClient::fetchAccountsList() {
    if (m_cfg.token.isEmpty()) return;
    QNetworkReply* r = m_net->get(v1Request("/accounts"));
    connect(r, &QNetworkReply::finished, this, [this, r]() {
        r->deleteLater();
        const int http = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        if (r->error() != QNetworkReply::NoError || http >= 400) return;   // the next poll retries
        const QJsonDocument doc = QJsonDocument::fromJson(r->readAll());
        const QJsonObject o = doc.object();
        const QJsonArray src = doc.isArray() ? doc.array()
                             : o.contains("items") ? o.value("items").toArray()
                                                   : o.value("accounts").toArray();
        // The same normalized shape LoginDialog writes into Config::accountsJson.
        QJsonArray norm;
        for (const QJsonValue& v : src) {
            const QJsonObject a = v.toObject();
            QString id = a.value("account_id").toString();
            if (id.isEmpty()) id = a.value("id").toString();
            if (id.isEmpty()) continue;
            QString number = a.value("account_number").toString();
            if (number.isEmpty()) number = id;
            QJsonObject n;
            n["account_id"]     = id;
            n["account_number"] = number;
            n["is_demo"]        = a.value("is_demo").toBool();
            n["currency"]       = a.value("currency").toString("USD");
            n["balance"]        = a.value("balance").toDouble();
            norm.append(n);
        }
        emit accountsListReceived(QString::fromUtf8(QJsonDocument(norm).toJson(QJsonDocument::Compact)));
    });
}

void ApiClient::placeOrder(const QString& action, const QString& symbol, double volume,
                           double sl, double tp, const QString& comment) {
    QJsonObject body;
    body["action"] = action.toUpper();
    body["symbol"] = symbol;
    body["volume"] = volume;
    if (sl > 0.0) body["sl"] = sl;
    if (tp > 0.0) body["tp"] = tp;
    if (!comment.isEmpty()) body["comment"] = comment;

    QNetworkReply* r = m_net->post(makeRequest("/trade"),
                                   QJsonDocument(body).toJson(QJsonDocument::Compact));
    handleReply(r, "trade", tr("Placing %1 %2").arg(action, symbol));
}

void ApiClient::closePositions(const QString& symbol) {
    QJsonObject body;
    body["action"] = "CLOSE";
    body["symbol"] = symbol;
    QNetworkReply* r = m_net->post(makeRequest("/trade"),
                                   QJsonDocument(body).toJson(QJsonDocument::Compact));
    handleReply(r, "trade", tr("Closing %1").arg(symbol));
}

// Emits positionOpResult when the reply arrives; parses FastAPI's {detail} on
// failure so the chart can restore the line and show why.
static void handlePositionOp(ApiClient* self, QNetworkReply* reply,
                             const QString& positionId, const QString& op) {
    QObject::connect(reply, &QNetworkReply::finished, self,
        [self, reply, positionId, op]() {
            reply->deleteLater();
            const QByteArray data = reply->readAll();
            const QJsonObject obj = QJsonDocument::fromJson(data).object();
            const int http = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
            const bool ok = (reply->error() == QNetworkReply::NoError && http < 400);
            QString msg;
            if (ok) {
                msg = obj.value("message").toString(op == "close" ? "Position closed" : "Updated");
            } else {
                msg = apiDetail(obj, reply->errorString());
            }
            emit self->positionOpResult(positionId, op, ok, msg);
        });
}

// Shared reply handling for the two order operations. Both answer with a
// FastAPI body, so the reason comes out through apiDetail() and reaches the
// user instead of Qt's generic "server replied: Bad Request".
static void handleOrderOp(ApiClient* self, QNetworkReply* reply, const QString& op) {
    QObject::connect(reply, &QNetworkReply::finished, self, [self, reply, op]() {
        reply->deleteLater();
        const int http = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QJsonObject o = QJsonDocument::fromJson(reply->readAll()).object();
        const bool ok = (reply->error() == QNetworkReply::NoError && http < 400);
        emit self->orderOpResult(
            op, ok,
            ok ? (op == "cancel" ? QObject::tr("Order cancelled")
                                 : QObject::tr("Pending order placed"))
               : apiDetail(o, reply->errorString()));
    });
}

void ApiClient::placePendingOrder(const QString& symbol, const QString& side,
                                  const QString& type, double lots, double price,
                                  double sl, double tp, const QString& comment) {
    QJsonObject body;
    body["account_id"] = m_cfg.accountId;
    body["symbol"]     = symbol;
    body["order_type"] = type.toLower();     // limit | stop
    body["side"]       = side.toLower();     // buy | sell
    body["lots"]       = lots;
    body["price"]      = price;
    if (sl > 0.0) body["stop_loss"]   = sl;
    if (tp > 0.0) body["take_profit"] = tp;
    body["comment"] = comment.isEmpty() ? QStringLiteral("terminal") : comment;

    QNetworkReply* r = m_net->post(v1Request("/orders/"),
                                   QJsonDocument(body).toJson(QJsonDocument::Compact));
    handleOrderOp(this, r, "place");
}

void ApiClient::modifyPendingOrder(const QString& orderId, double price, double lots,
                                   double sl, double tp) {
    QJsonObject body;
    if (price >= 0.0) body["price"] = price;
    if (lots  >  0.0) body["lots"]  = lots;
    // 0 is a real instruction here ("remove the bracket"), so the sentinel for
    // "leave alone" has to be negative rather than 0.
    if (sl >= 0.0) body["stop_loss"]   = sl > 0.0 ? QJsonValue(sl) : QJsonValue(QJsonValue::Null);
    if (tp >= 0.0) body["take_profit"] = tp > 0.0 ? QJsonValue(tp) : QJsonValue(QJsonValue::Null);
    if (body.isEmpty()) return;                 // nothing to send

    QNetworkReply* r = m_net->put(v1Request("/orders/" + orderId),
                                  QJsonDocument(body).toJson(QJsonDocument::Compact));
    handleOrderOp(this, r, "modify");
}

void ApiClient::cancelOrder(const QString& orderId) {
    QNetworkReply* r = m_net->deleteResource(v1Request("/orders/" + orderId));
    handleOrderOp(this, r, "cancel");
}

void ApiClient::modifyBracket(const QString& positionId, const QString& kind, double level) {
    const QString field = (kind == "tp") ? "take_profit" : "stop_loss";

    // level <= 0 means "remove this bracket", sent as an explicit JSON null.
    //
    // This used to be refused outright, because the server applied the update
    // with `if req.stop_loss is not None` — null read as "leave it alone", so
    // a removal answered 200 and the old level was back on the next poll. The
    // endpoint now keys off the fields the client actually sent, so null
    // genuinely clears. Only ONE field is ever sent, and the untouched one is
    // omitted rather than nulled, which is what stops a stop-loss edit from
    // wiping the take profit.
    QJsonObject body;
    if (level > 0.0) body[field] = level;
    else             body[field] = QJsonValue(QJsonValue::Null);
    QNetworkReply* r = m_net->put(v1Request("/positions/" + positionId),
                                  QJsonDocument(body).toJson(QJsonDocument::Compact));
    handlePositionOp(this, r, positionId, "modify");
}

void ApiClient::createShareLink(const QString& positionId, const QString& description,
                                const QString& linkDescription, const QString& mode) {
    QJsonObject body;
    // Null rather than "" for an empty box: the server stores the field as
    // given, and an empty string would print as a blank caption on the card.
    body["description"]      = description.isEmpty()     ? QJsonValue(QJsonValue::Null)
                                                          : QJsonValue(description);
    body["link_description"] = linkDescription.isEmpty() ? QJsonValue(QJsonValue::Null)
                                                          : QJsonValue(linkDescription);
    body["display_mode"]     = mode;

    QNetworkReply* r = m_net->post(v1Request("/positions/" + positionId + "/share"),
                                   QJsonDocument(body).toJson(QJsonDocument::Compact));
    connect(r, &QNetworkReply::finished, this, [this, r]() {
        r->deleteLater();
        const int http = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QJsonObject o = QJsonDocument::fromJson(r->readAll()).object();
        if (r->error() != QNetworkReply::NoError || http >= 400) {
            emit shareLinkCreated(false, apiDetail(o, r->errorString()));
            return;
        }
        const QString code = o.value("short_code").toString();
        if (code.isEmpty()) { emit shareLinkCreated(false, tr("No share code returned.")); return; }
        emit shareLinkCreated(true, code);
    });
}

void ApiClient::modifyComment(const QString& positionId, const QString& comment) {
    QJsonObject body;
    // Always present, so the server sees the field as "set" and applies it —
    // clearing a comment is an empty string, not an omission.
    body["comment"] = comment;
    QNetworkReply* r = m_net->put(v1Request("/positions/" + positionId),
                                  QJsonDocument(body).toJson(QJsonDocument::Compact));
    handlePositionOp(this, r, positionId, "comment");
}

// The refresh cookie is sent by hand rather than through a cookie jar: the
// terminal's managers are per-widget and none of them outlives a restart, so
// the credential has to travel in Config, not in QNetworkAccessManager.
void ApiClient::refreshSession() {
    if (m_cfg.refreshToken.trimmed().isEmpty()) {
        emit sessionRefreshFailed(tr("No stored session to refresh."));
        return;
    }
    QString base = m_cfg.restBase;
    base.replace("/api/algo", "/api/v1");

    QNetworkRequest req{QUrl(base + "/auth/refresh")};
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    req.setRawHeader("Cookie", ("pt_refresh=" + m_cfg.refreshToken).toUtf8());
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                     QNetworkRequest::NoLessSafeRedirectPolicy);

    QNetworkReply* r = m_net->post(req, QByteArray("{}"));
    connect(r, &QNetworkReply::finished, this, [this, r]() {
        r->deleteLater();
        const int http = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QJsonObject o = QJsonDocument::fromJson(r->readAll()).object();
        if (r->error() != QNetworkReply::NoError || http >= 400) {
            emit sessionRefreshFailed(apiDetail(o, r->errorString()));
            return;
        }
        const QString access = o.value("access_token").toString();

        // Pick the replacement refresh cookie out of Set-Cookie. Missing it
        // would leave the old, now-invalidated token in Config and every later
        // refresh would 401 — the failure mode is silent until the session dies.
        QString newRefresh;
        const QVariant sc = r->header(QNetworkRequest::SetCookieHeader);
        for (const QNetworkCookie& ck : sc.value<QList<QNetworkCookie>>())
            if (ck.name() == "pt_refresh") newRefresh = QString::fromUtf8(ck.value());

        if (access.isEmpty()) { emit sessionRefreshFailed(tr("Refresh returned no token.")); return; }
        emit sessionRefreshed(access, newRefresh);
    });
}

void ApiClient::closePositionById(const QString& positionId, double lots) {
    // The endpoint takes an optional "lots". Omitting it means close the whole
    // position, so a full close sends {} rather than the size — the server then
    // uses its own record of the position instead of trusting a number this
    // client may have read one poll ago.
    QByteArray body("{}");
    if (lots > 0.0) {
        QJsonObject o;
        o["lots"] = lots;
        body = QJsonDocument(o).toJson(QJsonDocument::Compact);
    }
    QNetworkReply* r = m_net->post(v1Request("/positions/" + positionId + "/close"), body);
    handlePositionOp(this, r, positionId, "close");
}

// --- reply dispatch --------------------------------------------------------

void ApiClient::handleReply(QNetworkReply* reply, const QString& kind, const QString& context) {
    connect(reply, &QNetworkReply::finished, this, [this, reply, kind, context]() {
        reply->deleteLater();
        const QByteArray data = reply->readAll();
        const QJsonDocument doc = QJsonDocument::fromJson(data);
        const QJsonObject obj = doc.object();

        const int http = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();

        if (reply->error() != QNetworkReply::NoError || (http >= 400)) {
            const QString detail = apiDetail(obj, reply->errorString());
            // The caller waiting on these bars is told directly, by its tag,
            // instead of sitting on a timeout.
            if (kind == "bars")
                emit barsFailed(QUrlQuery(reply->url()).queryItemValue("tag"), detail);
            if (kind == "trade") {
                // Surface trade failures both as a result and an error.
                TradeResult tr_;
                tr_.ok = false;
                tr_.status = "error";
                tr_.message = detail;
                emit tradeResult(tr_);
            }
            emit errorOccurred(context, detail, http);
            return;
        }

        if (kind == "symbols") {
            QVector<SymbolSpec> out;
            for (const QJsonValue& v : obj.value("symbols").toArray())
                out.push_back(parseSymbol(v.toObject()));
            emit symbolsReceived(out);
        } else if (kind == "account") {
            emit accountReceived(parseAccount(obj));
        } else if (kind == "prices") {
            QVector<Quote> out;
            for (const QJsonValue& v : obj.value("prices").toArray())
                out.push_back(parseQuote(v.toObject()));
            emit pricesReceived(out);
        } else if (kind == "bars") {
            QVector<Bar> out;
            for (const QJsonValue& v : obj.value("bars").toArray())
                out.push_back(parseBar(v.toObject()));
            emit barsReceived(obj.value("symbol").toString(),
                              obj.value("timeframe").toString(), out,
                              QUrlQuery(reply->url()).queryItemValue("tag"));
        } else if (kind == "transactions") {
            QJsonArray arr = doc.isArray() ? doc.array()
                           : obj.contains("items") ? obj.value("items").toArray()
                                                   : obj.value("transactions").toArray();
            QVector<Transaction> out;
            for (const QJsonValue& v : arr) out.push_back(parseTransaction(v.toObject()));
            emit transactionsReceived(out);
        } else if (kind == "positions" || kind == "orders" || kind == "history") {
            // Three shapes in the wild: a bare array (platform positions and
            // orders), {"items": [...]} (paged history), and {"<kind>": [...]}
            // (the old algo gateway).
            QJsonArray arr;
            if (doc.isArray())                       arr = doc.array();
            else if (obj.contains("items"))          arr = obj.value("items").toArray();
            else                                     arr = obj.value(kind).toArray();

            if (kind == "positions") {
                QVector<OpenPosition> out;
                for (const QJsonValue& v : arr) out.push_back(parsePosition(v.toObject()));
                emit positionsReceived(out);
            } else if (kind == "orders") {
                QVector<PendingOrder> out;
                for (const QJsonValue& v : arr) {
                    PendingOrder p = parseOrder(v.toObject());
                    // Belt and braces over the status=pending query above: an
                    // order that is already filled, cancelled or expired must
                    // never reach a tab whose only control is Cancel. An empty
                    // status is kept — some payloads omit the field, and
                    // hiding a real pending order would be the worse failure.
                    if (!p.status.isEmpty() &&
                        p.status.compare("pending", Qt::CaseInsensitive) != 0) continue;
                    out.push_back(p);
                }
                emit ordersReceived(out);
            } else {
                QVector<HistoryTrade> out;
                for (const QJsonValue& v : arr) out.push_back(parseHistory(v.toObject()));
                emit historyReceived(out);
            }
        } else if (kind == "trade") {
            TradeResult t;
            t.status      = obj.value("status").toString();
            t.ok          = (t.status == "filled" || t.status == "closed" || t.status == "no_positions");
            t.symbol      = obj.value("symbol").toString();
            t.action      = obj.value("action").toString();
            t.lots        = obj.value("lots").toDouble();
            t.price       = obj.value("price").toDouble();
            t.positionId  = obj.value("position_id").toString();
            t.orderId     = obj.value("order_id").toString();
            t.closedCount = obj.value("closed_count").toInt();
            t.totalProfit = obj.value("total_profit").toDouble();
            t.message     = obj.value("message").toString();
            emit tradeResult(t);
        }
    });
}
