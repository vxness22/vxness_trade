#pragma once
#include <QDialog>
#include "core/Config.h"

class QLineEdit;
class QComboBox;
class QCheckBox;
class QPushButton;
class QLabel;
class QStackedWidget;
class QSpinBox;
class QNetworkAccessManager;
class QNetworkReply;
class QJsonObject;

// File > Open an Account — the whole signup, without leaving the terminal.
//
// Three steps, because that is what the platform actually requires:
//
//   1. Details       -> POST /auth/register/start
//   2. Email code    -> POST /auth/register/verify   (mints the session)
//   3. Account type  -> GET  /accounts/available-groups, POST /accounts/open
//
// Step 2 is not optional politeness: register/start does not create a usable
// user, and /auth/login refuses an address that was never verified. A dialog
// that stopped after step 1 would hand the trader an account they cannot sign
// in to. Registration also does not create a TRADING account — only a user —
// which is why step 3 exists and why the login ID this dialog finishes on comes
// from /accounts/open rather than from the signup.
//
// Pre-auth work, so it talks to the API directly through its own network access
// manager rather than through ApiClient, exactly as LoginDialog does.
class OpenAccountDialog : public QDialog {
    Q_OBJECT
public:
    explicit OpenAccountDialog(const Config& cfg, QWidget* parent = nullptr);

    // The session this dialog signed the new trader in with, ready for the
    // caller to adopt. Only meaningful after exec() returned Accepted.
    Config config() const { return m_cfg; }
    // The account number to show the trader. Empty if they closed the dialog
    // before step 3 completed.
    QString accountNumber() const { return m_accountNumber; }

private slots:
    void submitDetails();    // step 1
    void submitOtp();        // step 2
    void resendOtp();
    void submitOpen();       // step 3

private:
    QWidget* buildDetailsStep();
    QWidget* buildOtpStep();
    QWidget* buildAccountStep();

    QString v1Base() const;
    // Shared reply handling: turns a QNetworkReply into either a JSON object or
    // a message a trader can act on. The platform answers errors as
    // {"detail": "..."} and sometimes as a list of field errors; both are
    // flattened here so no call site has to know that.
    bool readReply(QNetworkReply* reply, QJsonObject* out, QString* error);
    // Takes the session a sign-up reply carries (token, refresh cookie, name).
    // Returns false when the reply holds no token.
    bool adoptSession(QNetworkReply* reply, const QJsonObject& o);

    // Local checks, run before anything is sent. The server validates all of
    // this too — this exists so a typo costs no round trip and so the message
    // points at the field rather than at the request.
    bool validateDetails(QString* error);

    void fetchGroups();      // after verification, for the Account Type list
    void setStatus(const QString& text, bool error);
    void setBusy(bool busy);
    void showStep(int index);

    Config   m_cfg;
    QString  m_token;         // session minted by register/verify
    QString  m_email;         // carried into step 2 and 3
    QString  m_accountsJson;
    QString  m_accountNumber;

    QStackedWidget* m_steps;
    QLabel*  m_title;
    QLabel*  m_subtitle;
    QLabel*  m_status;

    // step 1
    QLineEdit* m_fullName;
    QLineEdit* m_emailIn;
    QLineEdit* m_mobile;
    QComboBox* m_country;
    QLineEdit* m_password;
    QLineEdit* m_confirm;
    QLineEdit* m_referral;
    QCheckBox* m_terms;
    QPushButton* m_continueBtn;

    // step 2
    QLineEdit*   m_otp;
    QPushButton* m_verifyBtn;
    QPushButton* m_resendBtn;

    // step 3
    QComboBox*   m_accountType;
    QLabel*      m_typeDetail;    // leverage / minimum / commission of the pick
    QWidget*     m_currencyRow;   // hidden unless the server states a currency
    QLabel*      m_currency;
    QSpinBox*    m_leverage;
    QPushButton* m_openBtn;

    QNetworkAccessManager* m_net;
};
