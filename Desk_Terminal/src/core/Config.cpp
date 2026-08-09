#include "core/Config.h"
#include <QStandardPaths>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>

QString Config::filePath() {
    QString dir = QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation);
    if (dir.isEmpty())
        dir = QDir::homePath() + "/.vxness-terminal";
    QDir().mkpath(dir);
    return dir + "/config.json";
}

// NO legacy config migration — deliberately.
//
// This terminal was forked from the TuskaEx build (itself a Bull4x →
// SwissCresta lineage). Those earlier steps DID carry the config forward,
// because each was a rename of the same broker: same account, same backend,
// only the host moved. Vxness is a *different platform*. A TuskaEx token or
// API key authenticates nothing here, and adopting one would also drag its
// endpoints in — pointing this build at another broker's API. So a Vxness
// install starts with a clean config and a real sign-in.
//
// For the same reason nothing deletes those files either: the TuskaEx terminal
// may still be installed on this machine and its config is its own. The two
// coexist — different config path, different installer AppId.

Config Config::load() {
    Config c;
    QFile f(filePath());
    if (!f.open(QIODevice::ReadOnly))
        return c; // defaults

    const QJsonObject o = QJsonDocument::fromJson(f.readAll()).object();
    if (o.contains("token"))     c.token     = o.value("token").toString();
    if (o.contains("refreshToken")) c.refreshToken = o.value("refreshToken").toString();
    if (o.contains("accountId")) c.accountId = o.value("accountId").toString();
    if (o.contains("userName"))  c.userName  = o.value("userName").toString();
    if (o.contains("email"))     c.email     = o.value("email").toString();
    if (o.contains("theme"))     c.theme     = o.value("theme").toString("dark");
    if (o.contains("privacy"))   c.privacy   = o.value("privacy").toBool();
    if (o.contains("accountsJson")) c.accountsJson = o.value("accountsJson").toString();
    if (o.contains("apiKey"))    c.apiKey    = o.value("apiKey").toString();
    if (o.contains("apiSecret")) c.apiSecret = o.value("apiSecret").toString();
    // Clamped on the way in: a hand-edited or corrupt file must not put the
    // grid into a state setChartCount() would reject anyway.
    if (o.contains("chartCount"))
        c.chartCount = qBound(1, o.value("chartCount").toInt(1), 4);
    if (o.contains("chartSymbols")) {
        c.chartSymbols.clear();
        for (const QJsonValue& v : o.value("chartSymbols").toArray())
            c.chartSymbols << v.toString();
    }
    // Stored endpoints are accepted only if they still address THIS API shape.
    //
    // The Vxness terminal published in July 2025 wrote
    //     restBase = "https://api.vxness.in/api"
    // and shares this config path, so an upgrade inherits it. That base is not
    // merely unusable — it fails in a way that reads like a broken account.
    // ApiClient derives the platform routes as restBase.replace("/api/algo",
    // "/api/v1"), which is a no-op on a bare "/api", so sign-in POSTs to
    // /api/auth/login — a route that EXISTS (it is the website's) and returns a
    // token. The terminal then asks /api/accounts, gets 404, and reports an
    // empty account list to someone who demonstrably just signed in.
    //
    // So: keep a stored base only when it names the algo gateway, otherwise
    // fall back to the compiled default. A trader who genuinely wants another
    // host still sets it in the sign-in dialog, which writes a value that
    // satisfies this check.
    const QString storedRest = o.value("restBase").toString();
    if (storedRest.contains(QStringLiteral("/api/algo")))
        c.restBase = storedRest;

    const QString storedWs = o.value("wsUrl").toString();
    if (storedWs.contains(QStringLiteral("/ws/algo/")))
        c.wsUrl = storedWs;

    return c;
}

bool Config::save() const {
    QJsonObject o;
    o["token"]        = token;
    o["refreshToken"] = refreshToken;
    o["accountId"]    = accountId;
    o["userName"]     = userName;
    o["email"]        = email;
    o["theme"]        = theme;
    o["privacy"]      = privacy;
    o["accountsJson"] = accountsJson;
    o["apiKey"]       = apiKey;
    o["apiSecret"]    = apiSecret;
    o["restBase"]     = restBase;
    o["wsUrl"]        = wsUrl;
    o["chartCount"]   = chartCount;
    o["chartSymbols"] = QJsonArray::fromStringList(chartSymbols);

    QFile f(filePath());
    if (!f.open(QIODevice::WriteOnly | QIODevice::Truncate))
        return false;
    f.write(QJsonDocument(o).toJson(QJsonDocument::Indented));
    return true;
}
