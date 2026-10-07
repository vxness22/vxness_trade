#pragma once
#include <QString>
#include <QDateTime>
#include <QMetaType>
#include <QVector>

// Plain data structs mirroring the Vxness Algo API JSON shapes.

struct SymbolSpec {
    QString symbol;
    QString displayName;
    QString category;
    int     digits       = 5;
    double  minLot       = 0.01;
    double  maxLot       = 100.0;
    double  lotStep      = 0.01;
    double  contractSize = 100000.0;
};

// Full contract specification for one instrument, from
// GET /api/v1/trading/instruments/{symbol}.
//
// Separate from SymbolSpec because the two come from different gateways and
// carry different things. SymbolSpec is what /api/algo/symbols returns for
// every instrument at startup — enough to size an order and scale a price.
// This is the per-instrument detail a trader opens on demand: pip size, the
// configured spread, commission per lot and the overnight swaps. Asking for
// all of it up front would be a round trip per instrument for a panel that is
// usually never opened.
struct InstrumentSpec {
    QString symbol, displayName, segment;
    int     digits       = 5;
    double  pipSize      = 0.0;
    double  minLot       = 0.0;
    double  maxLot       = 0.0;
    double  contractSize = 0.0;
    QString spreadType;              // "pips" | "percentage" | …
    double  spreadValue  = 0.0;
    double  priceImpact  = 0.0;
    double  commissionPerLot = 0.0;
    // swap_long / swap_short are null until an admin configures them, and a
    // missing swap is not a zero swap — one is "not set", the other is a real
    // rate of nothing. The panel has to be able to tell them apart.
    bool    hasSwaps     = false;
    double  swapLong     = 0.0;
    double  swapShort    = 0.0;
    bool    swapFree     = false;
    bool    valid        = false;
    QString error;                   // why the lookup failed, when !valid
};

struct Quote {
    QString   symbol;
    double    bid    = 0.0;
    double    ask    = 0.0;
    double    spread = 0.0;
    // Raw feed mid, sent alongside the account's spread-adjusted bid/ask. The
    // chart plots this — it is what the history klines are, and what the web
    // chart plots — so the forming candle sits on the same basis as history.
    double    mid    = 0.0;
    QDateTime timestamp;
    bool      valid  = false;
};

struct Bar {
    QDateTime time;
    double open   = 0.0;
    double high   = 0.0;
    double low    = 0.0;
    double close  = 0.0;
    double volume = 0.0;
};

struct AccountInfo {
    QString account;
    QString currency = "USD";
    int     leverage = 100;
    double  balance     = 0.0;
    double  credit      = 0.0;
    double  equity      = 0.0;
    double  marginUsed  = 0.0;
    double  freeMargin  = 0.0;
    double  marginLevel = 0.0;
    bool    isDemo      = false;
    int     openPositions = 0;
    bool    valid = false;
};

// Result of a placed / closed order.
struct TradeResult {
    bool    ok = false;
    QString status;        // "filled" | "closed" | "no_positions" | "error"
    QString symbol;
    QString action;        // BUY | SELL | CLOSE
    double  lots  = 0.0;
    double  price = 0.0;
    QString positionId;
    QString orderId;
    int     closedCount  = 0;
    double  totalProfit  = 0.0;
    QString message;       // human message / error detail
};

// Open position with live floating P/L.
struct OpenPosition {
    QString id, symbol, side;
    double  lots = 0, openPrice = 0, currentPrice = 0, sl = 0, tp = 0;
    double  swap = 0, commission = 0, profit = 0;
    QString openedAt, comment;
    // USD value of one unit of the QUOTE currency, from the server. The chart
    // overlay multiplies a price delta by lots x contract, which is in the quote
    // currency (yen on USDJPY) — without this its P&L preview read ~150x off.
    double  quoteToUsd = 1.0;
    double  markBid = 0;      // raw bid the server's profit was computed at
};

// Pending (not-yet-filled) order.
struct PendingOrder {
    QString id, symbol, type, side;
    double  lots = 0, price = 0, sl = 0, tp = 0;
    QString createdAt, comment;
    // Carried so the blotter can drop anything already filled or cancelled.
    // /orders/ returns every order for the account unless asked otherwise, and
    // the Pending tab's only action is "cancel" — a filled order there is a
    // button that cannot work.
    QString status;
};

// Closed trade (history).
// A money movement on the account's ledger: deposits, withdrawals, transfers,
// commission, swap, admin adjustments. Distinct from HistoryTrade, which is a
// closed POSITION — a trade produces ledger rows but is not one itself.
struct Transaction {
    QString id, type, method, description, currency;
    double  amount = 0;
    QString createdAt;
};

struct HistoryTrade {
    QString id, symbol, side;
    double  lots = 0, openPrice = 0, closePrice = 0, profit = 0, swap = 0, commission = 0;
    // The brackets the position was carrying when it closed. The platform has
    // always sent these on a closed trade and the blotter simply never read
    // them, so History could not show the S/L and T/P columns MetaTrader puts
    // there — the two that say whether a losing trade was protected.
    // 0 means the bracket was not set, which is how every other table here
    // already reads an absent level.
    double  sl = 0, tp = 0;
    QString openedAt, closedAt, closeReason, comment;
};

Q_DECLARE_METATYPE(Quote)
Q_DECLARE_METATYPE(AccountInfo)
Q_DECLARE_METATYPE(TradeResult)
