#include "ui/NavigationDialog.h"
#include "ui/Theme.h"

#include <QHeaderView>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QTreeWidget>
#include <QVBoxLayout>

#include <algorithm>

namespace {
constexpr int AccountRole   = Qt::UserRole + 1;
constexpr int IndicatorRole = Qt::UserRole + 2;
// The mask the rest of the terminal uses when privacy mode hides balances and
// account numbers.
constexpr const char* MASK = "••••••";
}  // namespace

NavigationDialog::NavigationDialog(QWidget* parent)
    : QDialog(parent) {
    setWindowTitle(tr("Navigation"));
    // Modeless: a navigator is meant to sit beside the charts, not to block
    // them. The window keeps the instance, so closing it only hides it.
    setModal(false);
    resize(300, 460);

    const auto& p = Theme::p();
    setStyleSheet(QString(
        "QDialog { background:%1; }"
        "QTreeWidget { background:%2; color:%3; border:none; }"
        "QTreeWidget::item { padding:4px 2px; }")
        .arg(p.bg, p.tableBg, p.text));

    auto* root = new QVBoxLayout(this);
    root->setContentsMargins(10, 10, 10, 10);
    root->setSpacing(8);

    m_tree = new QTreeWidget;
    m_tree->setHeaderHidden(true);
    m_tree->setUniformRowHeights(true);
    root->addWidget(m_tree, 1);

    m_accounts = section(tr("Accounts"));

    m_indicators = section(tr("Indicators"));
    note(m_indicators, tr("Loading…"));
    // Collapsed: there are a hundred-odd indicators, and expanding them by
    // default would push Expert Advisors and Market off the bottom.
    m_indicators->setExpanded(false);

    QTreeWidgetItem* eas = section(tr("Expert Advisors"));
    note(eas, tr("Not available yet — see Insert > Expert Advisor"));

    QTreeWidgetItem* market = section(tr("Market"));
    note(market, tr("Not available yet"));

    connect(m_tree, &QTreeWidget::itemDoubleClicked, this,
            [this](QTreeWidgetItem* item, int) {
        const QString id = item->data(0, AccountRole).toString();
        if (!id.isEmpty()) {
            emit accountActivated(id);
            return;
        }
        const QString indicator = item->data(0, IndicatorRole).toString();
        if (!indicator.isEmpty()) emit indicatorActivated(indicator);
    });
}

QTreeWidgetItem* NavigationDialog::section(const QString& title) {
    auto* item = new QTreeWidgetItem(m_tree, {title});
    QFont f = item->font(0);
    f.setBold(true);
    item->setFont(0, f);
    item->setFlags(item->flags() & ~Qt::ItemIsSelectable);
    item->setExpanded(true);
    return item;
}

void NavigationDialog::note(QTreeWidgetItem* parent, const QString& text) {
    auto* item = new QTreeWidgetItem(parent, {text});
    item->setFlags(item->flags() & ~Qt::ItemIsSelectable);
    item->setForeground(0, QColor(Theme::p().muted));
    QFont f = item->font(0);
    f.setItalic(true);
    item->setFont(0, f);
}

void NavigationDialog::setAccounts(const QString& accountsJson,
                                   const QString& currentId, bool privacy) {
    // Rebuilt wholesale rather than diffed: the list is a handful of rows and
    // arrives complete every time, so reconciling it would be more code with
    // more ways to go wrong.
    while (m_accounts->childCount() > 0)
        delete m_accounts->takeChild(0);

    const QJsonArray accounts =
        QJsonDocument::fromJson(accountsJson.toUtf8()).array();
    if (accounts.isEmpty()) {
        note(m_accounts, tr("Sign in to see your accounts"));
        return;
    }

    for (const QJsonValue& v : accounts) {
        const QJsonObject o = v.toObject();
        const QString id = o.value("account_id").toString();
        const QString number = privacy ? QString::fromUtf8(MASK)
                                       : o.value("account_number").toString();
        auto* row = new QTreeWidgetItem(
            m_accounts,
            {QString("%1  ·  %2").arg(number, o.value("is_demo").toBool() ? tr("DEMO")
                                                                          : tr("LIVE"))});
        row->setData(0, AccountRole, id);
        if (id == currentId) {
            QFont f = row->font(0);
            f.setBold(true);
            row->setFont(0, f);
            row->setForeground(0, QColor(Theme::p().accent));
            row->setToolTip(0, tr("Connected"));
        } else {
            row->setToolTip(0, tr("Double-click to connect to this account"));
        }
    }
    m_accounts->setExpanded(true);
}

void NavigationDialog::setIndicators(const QString& namesJson) {
    const QJsonArray names = QJsonDocument::fromJson(namesJson.toUtf8()).array();
    // Nothing yet — the chart is still loading. Leave the "Loading…" note in
    // place rather than replacing it with an empty section.
    if (names.isEmpty()) return;

    while (m_indicators->childCount() > 0)
        delete m_indicators->takeChild(0);

    QStringList sorted;
    sorted.reserve(names.size());
    for (const QJsonValue& v : names) {
        const QString n = v.toString();
        if (!n.isEmpty()) sorted << n;
    }
    // The library returns them in its own order; alphabetical is the only order
    // a trader can scan a hundred names in.
    std::sort(sorted.begin(), sorted.end(), [](const QString& a, const QString& b) {
        return a.compare(b, Qt::CaseInsensitive) < 0;
    });

    for (const QString& n : sorted) {
        auto* row = new QTreeWidgetItem(m_indicators, {n});
        row->setData(0, IndicatorRole, n);
        row->setToolTip(0, tr("Double-click to add to the active chart"));
    }
}
