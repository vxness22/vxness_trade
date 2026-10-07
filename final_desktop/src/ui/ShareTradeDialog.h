#pragma once
#include <QDialog>
#include <QPixmap>
#include "core/Models.h"

class ApiClient;
class QLabel;
class QLineEdit;
class QPlainTextEdit;
class QPushButton;
class QRadioButton;

// "Share trade" — the desktop counterpart of the web platform's share card.
//
// A trader closes a good day and wants to post it. Until now the desktop had
// no answer at all: the only way out of this terminal was a screenshot of a
// blotter row, which carries no branding, no context and no link back.
//
// The card is painted with QPainter rather than built from widgets or rendered
// through a web view. It has to leave here as a PNG at twice the preview's
// size, and painting it means one description of the layout that serves both
// the preview and the export — a widget tree would need grabbing, scaling and
// a second set of styles to survive it.
//
// The link itself is minted by the platform (POST /positions/{id}/share), so a
// card shared from the terminal opens the same public page as one shared from
// the website. The server reuses a live link for the same position, so editing
// the text and pressing the button again updates that link rather than
// scattering a new one each time.
class ShareTradeDialog : public QDialog {
    Q_OBJECT
public:
    ShareTradeDialog(const OpenPosition& position, const SymbolSpec& spec,
                     int leverage, ApiClient* api, const QString& restBase,
                     QWidget* parent = nullptr);

    // Public site that serves /s/<code>, derived from the API base: the trader
    // frontend, not the API host. Exposed for testing the mapping.
    static QString shareSiteFor(const QString& restBase);

private slots:
    void createLink();
    void downloadCard();
    void refreshCard();

private:
    // The card at `width` pixels wide, 4:5, everything scaled from that — so
    // the preview and the exported PNG are the same drawing at two sizes.
    QPixmap renderCard(int width) const;
    // The headline figure, per the selected mode.
    QString headline() const;
    QString displayMode() const;      // "pnl" | "roi" | "ticks"

    OpenPosition m_pos;
    SymbolSpec   m_spec;
    int          m_leverage;
    ApiClient*   m_api;
    QString      m_site;              // https://trade.… , no trailing slash
    QString      m_code;              // short code once the link is minted

    QLabel*         m_preview;
    QPlainTextEdit* m_desc;
    QPlainTextEdit* m_linkDesc;
    QLabel*         m_descCount;
    QLabel*         m_linkCount;
    QRadioButton*   m_modePnl;
    QRadioButton*   m_modeRoi;
    QRadioButton*   m_modeTicks;
    QLineEdit*      m_urlBox;
    QPushButton*    m_createBtn;
    QPushButton*    m_downloadBtn;
    QLabel*         m_status;
};
