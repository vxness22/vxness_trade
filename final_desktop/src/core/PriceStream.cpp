#include "core/PriceStream.h"
#include <QJsonDocument>
#include <QJsonObject>
#include <QAbstractSocket>

PriceStream::PriceStream(const Config& cfg, QObject* parent)
    : QObject(parent), m_cfg(cfg) {
    connect(&m_ws, &QWebSocket::connected,    this, &PriceStream::onConnected);
    connect(&m_ws, &QWebSocket::disconnected, this, &PriceStream::onDisconnected);
    connect(&m_ws, &QWebSocket::textMessageReceived, this, &PriceStream::onTextMessage);
    connect(&m_ws, QOverload<QAbstractSocket::SocketError>::of(&QWebSocket::errorOccurred),
            this, &PriceStream::onError);

    m_reconnectTimer.setSingleShot(true);
    m_reconnectTimer.setInterval(4000);
    connect(&m_reconnectTimer, &QTimer::timeout, this, [this]() {
        // Only from a closed socket: a late disconnected() from a socket that
        // restart() already replaced must not tear the new one down.
        if (m_wantRun && m_ws.state() == QAbstractSocket::UnconnectedState) {
            emit statusChanged(tr("Reconnecting…"));
            m_ws.open(QUrl(m_cfg.wsUrl));
        }
    });
}

PriceStream::~PriceStream() {
    // Members die in reverse declaration order, so m_reconnectTimer is already
    // gone when m_ws's destructor closes the socket. That close emits
    // disconnected(), and onDisconnected() — still believing the stream should
    // run, because quitting never called stop() — started the destroyed timer.
    // Every quit on a Mac ended in a SIGSEGV and a "quit unexpectedly" dialog.
    // Cut the socket's signals and stop the timer while both still exist.
    m_wantRun = false;
    m_ws.disconnect(this);
    m_reconnectTimer.stop();
}

void PriceStream::start() {
    m_wantRun = true;
    emit statusChanged(tr("Connecting…"));
    m_ws.open(QUrl(m_cfg.wsUrl));
}

void PriceStream::restart() {
    m_wantRun = false;               // the abort below must not schedule a retry
    m_reconnectTimer.stop();
    m_reconnectTimer.setInterval(4000);
    m_ws.abort();
    start();
}

void PriceStream::stop() {
    m_wantRun = false;
    m_reconnectTimer.stop();
    m_ws.close();
}

void PriceStream::onConnected() {
    m_authed = false;
    emit statusChanged(tr("Authenticating…"));
    QJsonObject auth;
    auth["action"] = "auth";
    // Same rule as ApiClient::makeRequest: a signed-in session authenticates
    // with its JWT and names the account selected on screen, so the quotes
    // carry THAT account's spread — the one an order on it fills at. The key
    // pair is only for the API-key (web service) mode, which has no session.
    if (!m_cfg.token.isEmpty() && !m_cfg.accountId.isEmpty()) {
        auth["token"]      = m_cfg.token;
        auth["account_id"] = m_cfg.accountId;
    } else if (!m_cfg.apiKey.isEmpty() && !m_cfg.apiSecret.isEmpty()) {
        auth["api_key"]    = m_cfg.apiKey;
        auth["api_secret"] = m_cfg.apiSecret;
    } else {
        auth["token"] = m_cfg.token;
    }
    m_ws.sendTextMessage(QString::fromUtf8(QJsonDocument(auth).toJson(QJsonDocument::Compact)));
}

void PriceStream::onDisconnected() {
    m_authed = false;
    if (m_wantRun) {
        emit statusChanged(tr("Disconnected — retrying…"));
        scheduleReconnect();
    } else {
        emit statusChanged(tr("Stopped"));
    }
}

void PriceStream::onError() {
    // Qt's errorString() here is Windows TLS-stack internals. A dropped Wi-Fi,
    // a resumed laptop or an idle connection reset upstream all surface as
    // "Schannel failed to encrypt data: The TLS/SSL connection has been
    // closed" — which tells a trader nothing except that something alarming
    // happened, and it stayed on screen in red while the terminal was already
    // reconnecting perfectly well.
    //
    // Say what it means for them. The socket detail still goes to the debug
    // log for anyone diagnosing a genuinely broken connection.
    qWarning("PriceStream socket error: %s", qPrintable(m_ws.errorString()));
    emit statusChanged(tr("Price feed disconnected — reconnecting…"));
    // disconnected() will fire and trigger reconnect if wanted.
}

void PriceStream::onTextMessage(const QString& msg) {
    const QJsonObject o = QJsonDocument::fromJson(msg.toUtf8()).object();

    // Auth acknowledgement
    if (o.value("status").toString() == "authenticated") {
        m_authed = true;
        m_reconnectTimer.setInterval(4000);
        const QString acct = o.value("account").toString();
        emit statusChanged(tr("Live • account %1").arg(acct));
        emit authenticated(acct);
        return;
    }

    // Rejected credentials. The server closes the socket right after this, and
    // retrying every 4 seconds with the same expired token only repeats it — the
    // feed sat on "Reconnecting…" forever with no reason given. Say why, slow
    // the retries down, and let the window renew the session; the next attempt
    // then uses the fresh token (setConfig).
    if (o.value("status").toString() == "error") {
        m_authed = false;
        m_reconnectTimer.setInterval(30000);
        const QString why = o.value("message").toString(tr("Invalid credentials"));
        emit statusChanged(tr("Price feed refused: %1").arg(why));
        emit authFailed(why);
        return;
    }

    const QString type = o.value("type").toString();
    if (type == "tick") {
        Quote q;
        q.symbol = o.value("symbol").toString();
        q.bid    = o.value("bid").toDouble();
        q.ask    = o.value("ask").toDouble();
        q.spread = o.value("spread").toDouble();
        q.mid    = o.value("mid").toDouble();
        q.timestamp = QDateTime::fromString(o.value("timestamp").toString(), Qt::ISODateWithMs);
        q.valid  = !q.symbol.isEmpty();
        if (q.valid) emit tickReceived(q);
    } else if (type == "ping") {
        QJsonObject pong; pong["type"] = "pong";
        m_ws.sendTextMessage(QString::fromUtf8(QJsonDocument(pong).toJson(QJsonDocument::Compact)));
    }
}

void PriceStream::scheduleReconnect() {
    if (m_wantRun && !m_reconnectTimer.isActive())
        m_reconnectTimer.start();
}
