#pragma once
#include <QDialog>
#include <QString>

class QTreeWidget;
class QTreeWidgetItem;
class QLabel;

// View > Navigation — MT5's Navigator panel.
//
// Four sections, as the desk specified: Accounts, Indicators, Expert Advisors
// and Market. Only Accounts is a live list today; the other three name what
// will live there and say plainly that it does not yet, rather than showing an
// empty tree that reads as broken.
//
// Modeless, and kept alive by the window between openings, because a navigator
// is something a trader leaves open beside the charts.
class NavigationDialog : public QDialog {
    Q_OBJECT
public:
    explicit NavigationDialog(QWidget* parent = nullptr);

    // The accounts list, as Config::accountsJson holds it, plus which one is
    // connected. Called again whenever the trader switches or signs in, so the
    // panel never shows a stale set.
    void setAccounts(const QString& accountsJson, const QString& currentId,
                     bool privacy);

    // The indicators the chart can draw, as the JSON array ChartArea reports.
    // Called again when the list arrives, since the panel can be opened before
    // the chart has finished loading.
    void setIndicators(const QString& namesJson);

signals:
    // A double-click on another account — the same switch the Accounts menu
    // performs.
    void accountActivated(const QString& accountId);
    // A double-click on an indicator — added to the active chart.
    void indicatorActivated(const QString& name);

private:
    QTreeWidgetItem* section(const QString& title);
    // A greyed, non-selectable child that explains an empty section.
    void note(QTreeWidgetItem* parent, const QString& text);

    QTreeWidget*     m_tree;
    QTreeWidgetItem* m_accounts;
    QTreeWidgetItem* m_indicators;
};
