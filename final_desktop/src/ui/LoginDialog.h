#pragma once
#include <QDialog>
#include <QPoint>
#include "core/Config.h"

class QLineEdit;
class QComboBox;
class QPushButton;
class QCheckBox;
class QLabel;
class QNetworkAccessManager;
class QJsonObject;
class QJsonArray;

// Two ways in, because different deployments authenticate differently:
//
//   1. Email/password (like the website) -> JWT + the user's trading accounts,
//      then the user picks an account. Needs POST /terminal/login on the host.
//   2. API key + secret -> sent as X-Api-Key / X-Api-Secret on every request.
//      There is no account picker: a key already identifies one account.
//
// Presented as a frameless two-panel card: a brand hero on the left, the form
// on the right. The endpoint fields are tucked behind "Advanced".
class LoginDialog : public QDialog {
    Q_OBJECT
public:
    // Which of the two the dialog opens on. File > Login to Trade Account is
    // the email/password path; File > Login to Web Service is the API key and
    // secret the dashboard issues for the algo/web service. Both write the same
    // Config — a desk can hold one credential without the other, which is why
    // they are separate entries rather than a toggle nobody finds.
    enum class Mode { TradeAccount, WebService };

    explicit LoginDialog(const Config& cfg, QWidget* parent = nullptr,
                         Mode mode = Mode::TradeAccount);
    Config config() const { return m_cfg; }

protected:
    // Frameless → drag the card by any empty part of it.
    void mousePressEvent(QMouseEvent* e) override;
    void mouseMoveEvent(QMouseEvent* e) override;

private slots:
    void doLogin();          // dispatches to the active sign-in mode
    void onConnect();
    void toggleAuthMode();   // email/password <-> API key

private:
    void doPasswordLogin();
    void doKeyLogin();
    QString v1Base() const;               // restBase with /api/algo -> /api/v1
    void postLogin(const QString& url, const QString& email,
                   const QString& pass, bool allowFallback);
    void onLoginJson(const QJsonObject& o);
    void fetchAccounts();                 // when login returns no account list
    void mintAlgoKey();                   // /api/algo needs a key, not the JWT
    void populateAccounts(const QJsonArray& accounts);
    void setBusy(bool busy);
    void setStatus(const QString& text, bool error);
    void showAccountStep();               // step 2 after a successful sign-in
    QWidget* buildBrandPanel();
    QWidget* buildFormPanel();

    Config       m_cfg;
    QLineEdit*   m_email;
    QLineEdit*   m_password;
    // MT5's "Remember password". Ticked, the password is kept in config.json
    // and prefills this field on the next launch; unticked, it is dropped and
    // any previously saved one is erased. See Config::savedPassword for what
    // that storage is and is not.
    QCheckBox*   m_remember;
    Mode         m_mode;
    QLineEdit*   m_rest;
    QLineEdit*   m_ws;
    QPushButton* m_loginBtn;
    QLineEdit*   m_apiKey;
    QLineEdit*   m_apiSecret;
    QWidget*     m_credRows;              // email/password block
    QWidget*     m_keyRows;               // API key/secret block
    QPushButton* m_modeBtn;               // switches between the two
    bool         m_keyMode = false;
    QWidget*     m_advanced;              // REST + WebSocket block (collapsible)
    QPushButton* m_advancedBtn;
    QLabel*      m_stepTitle;
    QLabel*      m_stepSub;
    QLabel*      m_accountLabel;
    QComboBox*   m_account;
    QPushButton* m_connectBtn;
    QLabel*      m_status;
    QNetworkAccessManager* m_net;
    QPoint       m_dragPos;

    QString m_token;
    QString m_userName;
    QString m_accountsJson;
};
