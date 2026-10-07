#include "ui/OpenAccountDialog.h"
#include "ui/Theme.h"

#include <QCheckBox>
#include <QComboBox>
#include <QDialogButtonBox>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QLocale>
#include <QNetworkAccessManager>
#include <QNetworkCookie>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPushButton>
#include <QRegularExpression>
#include <QSpinBox>
#include <QStackedWidget>
#include <QVBoxLayout>

#include <algorithm>

namespace {

// Every country Qt knows, by display name, so the list is neither hand-kept
// nor a freeform box the server has to guess at. The value sent is the ISO
// code, which is what the platform stores.
struct CountryEntry { QString name; QString code; };

QVector<CountryEntry> countries() {
    QVector<CountryEntry> out;
    for (const QLocale& l : QLocale::matchingLocales(QLocale::AnyLanguage,
                                                     QLocale::AnyScript,
                                                     QLocale::AnyTerritory)) {
        const QLocale::Territory t = l.territory();
        if (t == QLocale::AnyTerritory) continue;
        const QString code = QLocale::territoryToCode(t);
        if (code.isEmpty()) continue;
        out.append({QLocale::territoryToString(t), code});
    }
    std::sort(out.begin(), out.end(), [](const CountryEntry& a, const CountryEntry& b) {
        return a.name.localeAwareCompare(b.name) < 0;
    });
    out.erase(std::unique(out.begin(), out.end(),
                          [](const CountryEntry& a, const CountryEntry& b) {
                              return a.code == b.code;
                          }),
              out.end());
    return out;
}

// One labelled row, matching the sign-in card's caption-above-input shape.
QWidget* field(const QString& caption, QWidget* input) {
    auto* w = new QWidget;
    auto* v = new QVBoxLayout(w);
    v->setContentsMargins(0, 0, 0, 0);
    v->setSpacing(6);
    auto* l = new QLabel(caption);
    l->setObjectName("fieldLabel");
    v->addWidget(l);
    v->addWidget(input);
    return w;
}

}  // namespace

OpenAccountDialog::OpenAccountDialog(const Config& cfg, QWidget* parent)
    : QDialog(parent), m_cfg(cfg), m_net(new QNetworkAccessManager(this)) {
    setWindowTitle(tr("Open an Account"));
    setModal(true);
    setMinimumWidth(520);

    const auto& p = Theme::p();
    setStyleSheet(QString(
        "QDialog { background:%1; }"
        "QLabel { color:%2; }"
        "QLabel#fieldLabel { color:%3; font-size:11px; font-weight:700;"
        "                    letter-spacing:0.6px; }"
        "QLineEdit, QComboBox, QSpinBox {"
        "  background:%4; color:%2; border:1px solid %5; border-radius:6px;"
        "  padding:7px 9px; }"
        "QLineEdit:focus, QComboBox:focus, QSpinBox:focus { border-color:%6; }")
        .arg(p.bg, p.text, p.muted, p.inputBg, p.inputBorder, p.accent));

    auto* root = new QVBoxLayout(this);
    root->setContentsMargins(22, 20, 22, 18);
    root->setSpacing(10);

    m_title = new QLabel;
    m_title->setStyleSheet(QString("color:%1; font-size:18px; font-weight:800;")
                           .arg(p.textStrong));
    root->addWidget(m_title);

    m_subtitle = new QLabel;
    m_subtitle->setWordWrap(true);
    m_subtitle->setStyleSheet(QString("color:%1; font-size:12px;").arg(p.muted));
    root->addWidget(m_subtitle);
    root->addSpacing(8);

    m_steps = new QStackedWidget;
    m_steps->addWidget(buildDetailsStep());
    m_steps->addWidget(buildOtpStep());
    m_steps->addWidget(buildAccountStep());
    root->addWidget(m_steps, 1);

    m_status = new QLabel;
    m_status->setWordWrap(true);
    m_status->setStyleSheet("font-size:12px; font-weight:600;");
    root->addWidget(m_status);

    showStep(0);
}

// ── step 1: details ─────────────────────────────────────────────────────────

QWidget* OpenAccountDialog::buildDetailsStep() {
    auto* w = new QWidget;
    auto* v = new QVBoxLayout(w);
    v->setContentsMargins(0, 0, 0, 0);
    v->setSpacing(12);

    m_fullName = new QLineEdit;
    m_fullName->setPlaceholderText(tr("As it appears on your ID"));
    v->addWidget(field(tr("FULL NAME"), m_fullName));

    m_emailIn = new QLineEdit;
    m_emailIn->setPlaceholderText(tr("you@example.com"));
    v->addWidget(field(tr("EMAIL ADDRESS"), m_emailIn));

    m_mobile = new QLineEdit;
    m_mobile->setPlaceholderText(tr("+91 98765 43210"));
    v->addWidget(field(tr("MOBILE NUMBER"), m_mobile));

    m_country = new QComboBox;
    for (const CountryEntry& c : countries())
        m_country->addItem(c.name, c.code);
    // Default to the machine's own country rather than the alphabetical first,
    // which would otherwise sign every new trader up in Afghanistan.
    const int here = m_country->findData(QLocale::territoryToCode(QLocale::system().territory()));
    if (here >= 0) m_country->setCurrentIndex(here);
    v->addWidget(field(tr("COUNTRY"), m_country));

    auto* pwRow = new QHBoxLayout;
    pwRow->setSpacing(12);
    m_password = new QLineEdit;
    m_password->setEchoMode(QLineEdit::Password);
    m_password->setPlaceholderText(tr("At least 8 characters"));
    m_confirm = new QLineEdit;
    m_confirm->setEchoMode(QLineEdit::Password);
    m_confirm->setPlaceholderText(tr("Repeat it"));
    pwRow->addWidget(field(tr("PASSWORD"), m_password), 1);
    pwRow->addWidget(field(tr("CONFIRM PASSWORD"), m_confirm), 1);
    v->addLayout(pwRow);

    auto* hint = new QLabel(tr("Mix at least three of: lowercase, uppercase, "
                               "number, symbol."));
    hint->setStyleSheet(QString("color:%1; font-size:11px;").arg(Theme::p().muted));
    v->addWidget(hint);

    m_referral = new QLineEdit;
    m_referral->setPlaceholderText(tr("Optional"));
    v->addWidget(field(tr("REFERRAL CODE"), m_referral));

    m_terms = new QCheckBox(tr("I accept the Terms and Conditions and the "
                               "Risk Disclosure."));
    m_terms->setCursor(Qt::PointingHandCursor);
    v->addWidget(m_terms);

    v->addStretch(1);
    m_continueBtn = new QPushButton(tr("Continue"));
    m_continueBtn->setDefault(true);
    m_continueBtn->setCursor(Qt::PointingHandCursor);
    connect(m_continueBtn, &QPushButton::clicked, this, &OpenAccountDialog::submitDetails);

    auto* btns = new QHBoxLayout;
    btns->addStretch(1);
    auto* cancel = new QPushButton(tr("Cancel"));
    cancel->setCursor(Qt::PointingHandCursor);
    connect(cancel, &QPushButton::clicked, this, &QDialog::reject);
    btns->addWidget(cancel);
    btns->addWidget(m_continueBtn);
    v->addLayout(btns);
    return w;
}

// ── step 2: email code ──────────────────────────────────────────────────────

QWidget* OpenAccountDialog::buildOtpStep() {
    auto* w = new QWidget;
    auto* v = new QVBoxLayout(w);
    v->setContentsMargins(0, 0, 0, 0);
    v->setSpacing(12);

    m_otp = new QLineEdit;
    m_otp->setPlaceholderText(tr("6-digit code"));
    m_otp->setMaxLength(6);
    connect(m_otp, &QLineEdit::returnPressed, this, &OpenAccountDialog::submitOtp);
    v->addWidget(field(tr("VERIFICATION CODE"), m_otp));
    v->addStretch(1);

    auto* btns = new QHBoxLayout;
    m_resendBtn = new QPushButton(tr("Resend code"));
    m_resendBtn->setCursor(Qt::PointingHandCursor);
    connect(m_resendBtn, &QPushButton::clicked, this, &OpenAccountDialog::resendOtp);
    btns->addWidget(m_resendBtn);
    btns->addStretch(1);
    m_verifyBtn = new QPushButton(tr("Verify"));
    m_verifyBtn->setDefault(true);
    m_verifyBtn->setCursor(Qt::PointingHandCursor);
    connect(m_verifyBtn, &QPushButton::clicked, this, &OpenAccountDialog::submitOtp);
    btns->addWidget(m_verifyBtn);
    v->addLayout(btns);
    return w;
}

// ── step 3: account type ────────────────────────────────────────────────────

QWidget* OpenAccountDialog::buildAccountStep() {
    auto* w = new QWidget;
    auto* v = new QVBoxLayout(w);
    v->setContentsMargins(0, 0, 0, 0);
    v->setSpacing(12);

    m_accountType = new QComboBox;
    v->addWidget(field(tr("ACCOUNT TYPE"), m_accountType));

    m_typeDetail = new QLabel;
    m_typeDetail->setWordWrap(true);
    m_typeDetail->setStyleSheet(QString("color:%1; font-size:11px;").arg(Theme::p().muted));
    v->addWidget(m_typeDetail);

    // Base currency is a property of the account type, not a separate choice,
    // and the groups endpoint does not always state it. Shown when it does,
    // hidden when it does not, rather than guessing at "USD".
    m_currency = new QLabel;
    m_currency->setStyleSheet(QString("color:%1; font-weight:700;").arg(Theme::p().text));
    m_currencyRow = field(tr("BASE CURRENCY"), m_currency);
    m_currencyRow->hide();
    v->addWidget(m_currencyRow);

    m_leverage = new QSpinBox;
    m_leverage->setRange(1, 2000);
    m_leverage->setPrefix(tr("1 : "));
    v->addWidget(field(tr("LEVERAGE"), m_leverage));

    // Re-read the chosen group whenever the pick changes: the leverage ceiling,
    // the minimum deposit and the currency all belong to it.
    connect(m_accountType, &QComboBox::currentIndexChanged, this, [this](int i) {
        if (i < 0) return;
        const QJsonObject g = QJsonDocument::fromJson(
            m_accountType->itemData(i).toString().toUtf8()).object();
        const int maxLev = g.value("effective_max_leverage").toInt(
            g.value("max_leverage").toInt(100));
        m_leverage->setMaximum(qMax(1, maxLev));
        m_leverage->setValue(qBound(1, g.value("leverage_default").toInt(100), qMax(1, maxLev)));

        QStringList bits;
        const QString desc = g.value("description").toString();
        if (!desc.isEmpty()) bits << desc;
        bits << tr("Maximum leverage 1:%1").arg(maxLev);
        const double minDep = g.value("minimum_deposit").toDouble();
        if (minDep > 0)
            bits << tr("Minimum deposit $%L1").arg(minDep, 0, 'f', 2);
        if (g.value("kyc_unlock_required").toBool())
            bits << tr("Higher leverage unlocks after KYC");
        if (g.value("swap_free").toBool())
            bits << tr("Swap-free");
        m_typeDetail->setText(bits.join(QStringLiteral(" · ")));

        const QString ccy = g.value("currency").toString();
        m_currency->setText(ccy);
        m_currencyRow->setVisible(!ccy.isEmpty());
    });

    v->addStretch(1);
    auto* btns = new QHBoxLayout;
    btns->addStretch(1);
    m_openBtn = new QPushButton(tr("Open account"));
    m_openBtn->setDefault(true);
    m_openBtn->setCursor(Qt::PointingHandCursor);
    connect(m_openBtn, &QPushButton::clicked, this, &OpenAccountDialog::submitOpen);
    btns->addWidget(m_openBtn);
    v->addLayout(btns);
    return w;
}

// ── plumbing ────────────────────────────────────────────────────────────────

QString OpenAccountDialog::v1Base() const {
    QString base = m_cfg.restBase.trimmed();
    base.replace("/api/algo", "/api/v1");
    return base;
}

void OpenAccountDialog::showStep(int index) {
    m_steps->setCurrentIndex(index);
    m_status->clear();
    switch (index) {
    case 0:
        m_title->setText(tr("Open an Account"));
        m_subtitle->setText(tr("Create a Vxness account and your first trading "
                               "account, without leaving the terminal."));
        break;
    case 1:
        m_title->setText(tr("Confirm your email"));
        m_subtitle->setText(tr("We sent a 6-digit code to %1. Enter it to finish "
                               "creating your account.").arg(m_email));
        m_otp->setFocus();
        break;
    case 2:
        m_title->setText(tr("Choose your account type"));
        m_subtitle->setText(tr("This decides your leverage, spread and commission. "
                               "You can open more account types later."));
        break;
    default:
        break;
    }
}

void OpenAccountDialog::setStatus(const QString& text, bool error) {
    m_status->setStyleSheet(QString("font-size:12px; font-weight:600; color:%1;")
                            .arg(error ? Theme::p().down : Theme::p().up));
    m_status->setText(text);
}

void OpenAccountDialog::setBusy(bool busy) {
    m_continueBtn->setEnabled(!busy);
    m_verifyBtn->setEnabled(!busy);
    m_resendBtn->setEnabled(!busy);
    m_openBtn->setEnabled(!busy);
}

bool OpenAccountDialog::readReply(QNetworkReply* reply, QJsonObject* out, QString* error) {
    const QByteArray body = reply->readAll();
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const QJsonDocument doc = QJsonDocument::fromJson(body);

    if (reply->error() != QNetworkReply::NoError || status >= 400) {
        QString msg;
        if (doc.isObject()) {
            const QJsonValue detail = doc.object().value("detail");
            if (detail.isString()) {
                msg = detail.toString();
            } else if (detail.isArray()) {
                // FastAPI field errors: [{"loc":[…,"password"],"msg":"…"}, …].
                // Reported as "password: …" so the trader knows which box.
                QStringList parts;
                for (const QJsonValue& v : detail.toArray()) {
                    const QJsonObject e = v.toObject();
                    const QJsonArray loc = e.value("loc").toArray();
                    const QString fieldName = loc.isEmpty() ? QString()
                                                            : loc.last().toString();
                    const QString m = e.value("msg").toString();
                    parts << (fieldName.isEmpty() ? m : QString("%1: %2").arg(fieldName, m));
                }
                msg = parts.join("\n");
            }
        }
        if (msg.isEmpty()) msg = reply->errorString();
        if (error) *error = msg;
        return false;
    }
    if (out) *out = doc.object();
    return true;
}

// ── step 1 ──────────────────────────────────────────────────────────────────

bool OpenAccountDialog::validateDetails(QString* error) {
    auto fail = [error](const QString& m) { if (error) *error = m; return false; };

    if (m_fullName->text().trimmed().isEmpty())
        return fail(tr("Enter your full name."));
    // The platform stores a first and a last name, so a single word cannot be
    // split into one. Asked for here rather than guessed at.
    if (!m_fullName->text().trimmed().contains(QRegularExpression("\\s")))
        return fail(tr("Enter your first and last name."));

    const QString email = m_emailIn->text().trimmed();
    static const QRegularExpression emailRe(
        R"(^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$)");
    if (!emailRe.match(email).hasMatch())
        return fail(tr("That email address does not look right."));

    const QString mobile = m_mobile->text().trimmed();
    // Digits, spaces, dashes, brackets and a leading +; at least 7 digits. Kept
    // deliberately loose — numbering plans differ by country and a stricter
    // rule here would reject valid numbers the server accepts.
    if (!mobile.isEmpty()) {
        static const QRegularExpression phoneRe(R"(^\+?[0-9 ()\-]{7,20}$)");
        if (!phoneRe.match(mobile).hasMatch() ||
            mobile.count(QRegularExpression("[0-9]")) < 7)
            return fail(tr("That mobile number does not look right."));
    }

    const QString pw = m_password->text();
    if (pw.length() < 8)
        return fail(tr("Password must be at least 8 characters."));
    // Mirrors the server's rule so the trader is told before the round trip.
    const int classes = (pw.contains(QRegularExpression("[a-z]")) ? 1 : 0) +
                        (pw.contains(QRegularExpression("[A-Z]")) ? 1 : 0) +
                        (pw.contains(QRegularExpression("[0-9]")) ? 1 : 0) +
                        (pw.contains(QRegularExpression("[^a-zA-Z0-9]")) ? 1 : 0);
    if (classes < 3)
        return fail(tr("Password must mix at least 3 of: lowercase, uppercase, "
                       "number, symbol."));
    if (m_confirm->text() != pw)
        return fail(tr("The two passwords do not match."));
    if (!m_terms->isChecked())
        return fail(tr("You must accept the Terms and Conditions to continue."));
    return true;
}

void OpenAccountDialog::submitDetails() {
    QString error;
    if (!validateDetails(&error)) {
        setStatus(error, true);
        return;
    }

    const QString full = m_fullName->text().trimmed().simplified();
    const int cut = full.indexOf(QLatin1Char(' '));
    m_email = m_emailIn->text().trimmed();

    QJsonObject body;
    body["email"]      = m_email;
    body["password"]   = m_password->text();
    body["first_name"] = full.left(cut);
    body["last_name"]  = full.mid(cut + 1);
    if (!m_mobile->text().trimmed().isEmpty())
        body["phone"] = m_mobile->text().trimmed();
    body["country"] = m_country->currentData().toString();
    if (!m_referral->text().trimmed().isEmpty())
        body["referral_code"] = m_referral->text().trimmed();

    setBusy(true);
    setStatus(tr("Creating your account…"), false);

    QNetworkRequest req{QUrl(v1Base() + "/auth/register/start")};
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                     QNetworkRequest::NoLessSafeRedirectPolicy);

    QNetworkReply* reply = m_net->post(req, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        setBusy(false);
        QJsonObject o;
        QString err;
        if (!readReply(reply, &o, &err)) {
            setStatus(err, true);
            return;
        }
        // With email verification switched off the server creates the user
        // and signs them in right here (otp_required: false). Going to the code
        // step anyway asked for a code that was never sent, and every attempt
        // answered "Invalid verification code" for an account that existed.
        if (!o.value("otp_required").toBool(true)) {
            if (!adoptSession(reply, o)) {
                setStatus(tr("Your account was created, but the terminal did not "
                             "receive a session. Sign in from File > Login to Trade "
                             "Account."), true);
                return;
            }
            showStep(2);
            fetchGroups();
            return;
        }
        showStep(1);
    });
}

// ── step 2 ──────────────────────────────────────────────────────────────────

void OpenAccountDialog::submitOtp() {
    const QString code = m_otp->text().trimmed();
    if (code.isEmpty()) {
        setStatus(tr("Enter the code from your email."), true);
        return;
    }

    QJsonObject body;
    body["email"] = m_email;
    body["otp"]   = code;

    setBusy(true);
    setStatus(tr("Verifying…"), false);

    QNetworkRequest req{QUrl(v1Base() + "/auth/register/verify")};
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                     QNetworkRequest::NoLessSafeRedirectPolicy);

    QNetworkReply* reply = m_net->post(req, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        setBusy(false);
        QJsonObject o;
        QString err;
        if (!readReply(reply, &o, &err)) {
            setStatus(err, true);
            return;
        }
        // Verification mints the session, which is what lets step 3 reach the
        // authenticated /accounts endpoints without a second sign-in.
        if (!adoptSession(reply, o)) {
            setStatus(tr("Your account was created, but the terminal did not "
                         "receive a session. Sign in from File > Login to Trade "
                         "Account."), true);
            return;
        }
        showStep(2);
        fetchGroups();
    });
}

bool OpenAccountDialog::adoptSession(QNetworkReply* reply, const QJsonObject& o) {
    m_token = o.value("access_token").toString(o.value("token").toString());
    if (m_token.isEmpty()) return false;

    m_cfg.token = m_token;
    m_cfg.email = m_email;
    const QJsonObject user = o.value("user").toObject();
    m_cfg.userName = user.value("name").toString(
        user.value("first_name").toString(o.value("name").toString()));

    // The refresh credential travels only as the pt_refresh cookie. Without
    // taking it, the terminal kept the PREVIOUS login's refresh token, and its
    // 30-minute renewal then handed back that other user's session.
    m_cfg.refreshToken.clear();
    const QVariant sc = reply->header(QNetworkRequest::SetCookieHeader);
    for (const QNetworkCookie& ck : sc.value<QList<QNetworkCookie>>())
        if (ck.name() == "pt_refresh") m_cfg.refreshToken = QString::fromUtf8(ck.value());

    // An algo key minted for the previous login's account must not survive
    // into this one — it would keep routing orders to that account.
    m_cfg.apiKey.clear();
    m_cfg.apiSecret.clear();
    return true;
}

void OpenAccountDialog::resendOtp() {
    QJsonObject body;
    body["email"] = m_email;

    setBusy(true);
    QNetworkRequest req{QUrl(v1Base() + "/auth/register/resend")};
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                     QNetworkRequest::NoLessSafeRedirectPolicy);

    QNetworkReply* reply = m_net->post(req, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        setBusy(false);
        QJsonObject o;
        QString err;
        if (!readReply(reply, &o, &err)) {
            setStatus(err, true);
            return;
        }
        setStatus(tr("A new code is on its way to %1.").arg(m_email), false);
    });
}

// ── step 3 ──────────────────────────────────────────────────────────────────

void OpenAccountDialog::fetchGroups() {
    setBusy(true);
    setStatus(tr("Loading account types…"), false);

    QNetworkRequest req{QUrl(v1Base() + "/accounts/available-groups")};
    req.setRawHeader("Authorization", ("Bearer " + m_token).toUtf8());
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                     QNetworkRequest::NoLessSafeRedirectPolicy);

    QNetworkReply* reply = m_net->get(req);
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        setBusy(false);
        QJsonObject o;
        QString err;
        if (!readReply(reply, &o, &err)) {
            setStatus(err, true);
            return;
        }
        const QJsonArray items = o.value("items").toArray();
        if (items.isEmpty()) {
            setStatus(tr("Your broker has no account types open for self-service "
                         "right now. Your login is ready — contact support to have "
                         "a trading account added."), true);
            m_openBtn->setEnabled(false);
            return;
        }
        // The whole group object rides in the item's data so the detail line,
        // the leverage ceiling and the currency can all be read back without a
        // parallel list to keep in step with the combo.
        for (const QJsonValue& v : items) {
            const QJsonObject g = v.toObject();
            m_accountType->addItem(
                g.value("name").toString(),
                QString::fromUtf8(QJsonDocument(g).toJson(QJsonDocument::Compact)));
        }
        m_accountType->setCurrentIndex(0);
        m_status->clear();
    });
}

void OpenAccountDialog::submitOpen() {
    const int i = m_accountType->currentIndex();
    if (i < 0) {
        setStatus(tr("Choose an account type."), true);
        return;
    }
    const QJsonObject g = QJsonDocument::fromJson(
        m_accountType->itemData(i).toString().toUtf8()).object();

    QJsonObject body;
    body["account_group_id"] = g.value("id").toString();
    body["leverage"]         = m_leverage->value();

    setBusy(true);
    setStatus(tr("Opening your account…"), false);

    QNetworkRequest req{QUrl(v1Base() + "/accounts/open")};
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    req.setRawHeader("Authorization", ("Bearer " + m_token).toUtf8());
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                     QNetworkRequest::NoLessSafeRedirectPolicy);

    QNetworkReply* reply = m_net->post(req, QJsonDocument(body).toJson());
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        setBusy(false);
        QJsonObject o;
        QString err;
        if (!readReply(reply, &o, &err)) {
            setStatus(err, true);
            return;
        }
        m_accountNumber = o.value("account_number").toString();
        m_cfg.accountId = o.value("id").toString();
        if (m_cfg.accountId.isEmpty())
            m_cfg.accountId = o.value("account_id").toString();

        // Hand the caller a one-account list so the Accounts menu and the
        // identity line have something to show before the first poll returns.
        QJsonObject acct;
        acct["account_id"]     = m_cfg.accountId;
        acct["account_number"] = m_accountNumber;
        acct["is_demo"]        = o.value("is_demo").toBool(false);
        acct["currency"]       = o.value("currency").toString(QStringLiteral("USD"));
        m_cfg.accountsJson = QString::fromUtf8(
            QJsonDocument(QJsonArray{acct}).toJson(QJsonDocument::Compact));

        accept();
    });
}
