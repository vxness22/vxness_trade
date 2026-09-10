#pragma once
#include <QString>
#include <QStringList>

// Persists connection settings (API key/secret + endpoints) to a JSON file
// in the user's app-config directory. Plaintext — this is a local desktop
// terminal; keep the file private.
class Config {
public:
    // Terminal login (email/password → JWT). Preferred.
    QString token;         // JWT — access token, expires in ~45 minutes
    // The pt_refresh cookie from sign-in, used to mint a new access token
    // without asking for the password again. It is SINGLE USE: every refresh
    // returns a replacement and invalidates this one, so whatever comes back
    // must be stored here or the next refresh fails with 401.
    //
    // Worth knowing: this is a 7-day credential sitting in a plaintext file
    // next to the access token. It is no worse than what was already here, but
    // it is longer-lived — the file is the whole session.
    QString refreshToken;
    QString accountId;     // selected trading account id
    QString userName;      // display name from the login response
    QString email;         // the address signed in with (prefills the login form)
    QString accountsJson = "[]";   // [{account_id, account_number, is_demo, currency}]

    // UI preferences
    QString theme   = "light"; // "dark" | "light" — light mirrors the MT5 layout
    bool    privacy = false;   // mask balances / account numbers on screen

    // Chart grid, restored on the next launch. A trader who set up a 2x2 of
    // four instruments should not have to rebuild it every session — the
    // terminal used to always reopen on a single chart.
    // chartSymbols is left-to-right for the visible panes; a short or empty
    // list just means those panes open on the default symbol.
    int         chartCount = 1;   // 1..4
    QStringList chartSymbols;

    // Market Watch columns the trader has switched OFF, by key: "spread",
    // "high", "low", "time". Empty — the default — means every column is
    // present. The panel simply opens narrow enough to show Symbol, Bid and
    // Ask, and the rest are reached by scrolling it sideways rather than by
    // being absent. Hiding one for good is still available from its right-click
    // menu, which is what this list records.
    // Defaults to the four optional ones: Market Watch opens on Symbol, Bid
    // and Ask, and the panel is sized to exactly those. Switching one on from
    // the panel's Columns menu widens the panel to fit it, so a column is
    // never left half cut off at the boundary with the chart.
    QStringList watchHiddenColumns{QStringLiteral("spread"), QStringLiteral("high"),
                                   QStringLiteral("low"),    QStringLiteral("time")};

    // Instruments starred in Market Watch. Kept per trader rather than derived
    // from anything: a favourite is a statement about what someone watches, and
    // the only place that can be recorded is here.
    QStringList watchFavourites;

    // Instruments hidden from Market Watch, MT5's Hide / Hide All / Show All.
    // A desk trades a dozen of the sixty the broker lists, and scrolling past
    // the rest all day is the thing that menu exists to stop.
    QStringList watchHiddenSymbols;
    // Grid lines in the Market Watch table, also from that menu.
    bool        watchGrid = true;

    // Row colours a trader has put on instruments in Market Watch, as
    // "SYMBOL=name" entries ("XAUUSD=amber"). A flat list rather than a nested
    // object so it round-trips through the same JSON array handling as every
    // other preference here.
    QStringList watchSymbolColours;

    // The face the data tables are drawn in — Market Watch, the blotter, the
    // account strip — chosen from View > Font. Tahoma by default because that
    // is what MetaTrader 5 uses and what the desk asked to match; the size is
    // in pixels so it means the same thing on both platforms.
    QString tableFontFamily = QStringLiteral("Tahoma");
    int     tableFontSize   = 12;

    // Where the trader dragged the one-click strip on the chart, as a fraction
    // of the chart area (0..1 of the room the strip can move in). A fraction
    // rather than pixels so the strip keeps its place when the pane is resized
    // or the grid changes; -1 means untouched, and the strip sits where the
    // chart's own layout puts it.
    double ticketPosX = -1.0;
    double ticketPosY = -1.0;

    // The main window's geometry AND its maximized state, from
    // QWidget::saveGeometry(), base64'd so it survives a JSON round trip.
    // Empty means first run, which opens maximized: a trading screen with a
    // watchlist, a chart and a blotter has nothing to gain from a small window,
    // and every trader was maximizing it by hand on every launch.
    QString windowGeometry;

    // Legacy bot auth (still supported for a pasted API key).
    QString apiKey;
    QString apiSecret;

    // REST base, e.g. https://api.vxness.in/api/algo
    QString restBase = "https://api.vxness.in/api/algo";
    // WebSocket URL, e.g. wss://api.vxness.in/ws/algo/prices
    // WebSockets only work on the api. host — vxness.in proxies REST
    // but its nginx block does not upgrade the connection.
    QString wsUrl    = "wss://api.vxness.in/ws/algo/prices";

    bool hasToken() const {
        return !token.trimmed().isEmpty() && !accountId.trimmed().isEmpty();
    }
    bool hasCredentials() const {
        return hasToken() ||
               (!apiKey.trimmed().isEmpty() && !apiSecret.trimmed().isEmpty());
    }

    static QString filePath();   // resolved config file location
    static Config  load();       // load from disk (defaults if missing)
    bool           save() const; // write to disk; returns success

    // There is deliberately NO migration from the other brokers' builds this
    // terminal shares a lineage with — see the note in Config.cpp before
    // adding one back.
};
