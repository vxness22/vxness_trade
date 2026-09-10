#pragma once
#include <QString>
#include <QObject>
#include <QPalette>
#include <QFont>

// Central theme for the whole terminal — a light and a dark palette plus the
// global Qt style sheet built from whichever is active.
//
// Widgets must NOT hard-code colours. They read Theme::p() and rebuild their
// own inline style sheets in an applyTheme() slot connected to
// Theme::notifier()::changed(), which fires whenever the mode is switched.
namespace Theme {

enum class Mode { Dark, Light };

struct Palette {
    // surfaces
    QString bg, panel, panelAlt, headerBg, border;
    // type
    QString text, textStrong, muted, dim;
    // semantic
    QString accent, accentHover, up, down, warn;
    // inputs
    QString inputBg, inputBorder;
    // watchlist cards
    QString cardBg, cardBorder, cardHover, cardSelBg, cardSelBorder;
    // tables
    QString tableBg, tableAlt, rowHover, rowSel, rowSelText;
    // buttons
    QString btnBg, btnBorder, btnHover, btnPressed;
    // menus / popups
    QString menuBg, menuBorder, menuSel;
    // scrollbars
    QString scrollHandle, scrollHandleHover;
    // the embedded chart ("dark" | "light" for TradingView)
    QString chartBg;
};

// Emits changed() when the mode is switched; widgets restyle themselves on it.
class Notifier : public QObject {
    Q_OBJECT
public:
    explicit Notifier(QObject* parent = nullptr) : QObject(parent) {}
signals:
    void changed();
};

Notifier* notifier();

Mode            mode();
bool            isDark();
void            setMode(Mode m);          // no-op if unchanged; else emits changed()
const Palette&  p();
QString         styleSheet();             // global app style sheet for the active mode
// Style for a price spin box, steppers included.
//
// A style sheet on a spin box replaces the native drawing of its sub-controls,
// so the up/down arrows have to be described or the button column comes out as
// a blank grey block. They are drawn from two chevron images in the resource
// bundle. Shared, because every price field in the app wants the same thing
// and three copies of this had already started to drift.
QString         spinStyle();
// The face every data table uses — Market Watch, the trade blotter, history.
//
// The platform's own UI font at a dense size, NOT a monospace one. The tables
// used Consolas so digits would line up in a column, but that reads as a slab
// of code next to the rest of the app, and the desk asked for the compact
// proportional look MT5 has. Right-aligned number columns keep the decimal
// points together without needing fixed-width glyphs to do it.
QFont           tableFont();
// Changes the face the tables use and tells every widget to restyle, the same
// way a light/dark switch does. Family is given as a name; an empty one falls
// back to Tahoma. Size is in pixels.
void            setTableFont(const QString& family, int px);
QString         tableFontFamily();
int             tableFontSize();
QPalette        qtPalette();              // QPalette for the Fusion style
QString         name();                   // "dark" | "light"
Mode            fromName(const QString& n);

} // namespace Theme
