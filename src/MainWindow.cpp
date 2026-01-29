#include "MainWindow.h"

#include "Bridge.h"
#include "sddai_bridge.h"
#include "sddai_bridge.h"

#include <QAction>
#include <QDir>
#include <QCoreApplication>
#include <QFileDialog>
#include <QFileSystemModel>
#include <QKeySequence>
#include <QLabel>
#include <QMenuBar>
#include <QSplitter>
#include <QStatusBar>
#include <QTreeView>
#include <QWebChannel>
#include <QWebEngineView>

MainWindow::MainWindow(QWidget *parent) : QMainWindow(parent) {
    createUi();
    createMenu();
    setWindowTitle(QStringLiteral("SDDAI GUI (QtWebEngine + Cytoscape)"));
    resize(1200, 720);

    // Auto-open: prefer project root (one level above exe) to avoid landing in build/.
    const QString exeDir = QCoreApplication::applicationDirPath();
    const QString candidate = QDir(exeDir).absoluteFilePath(QStringLiteral(".."));
    openProject(QDir(candidate).absolutePath());
}

MainWindow::~MainWindow() = default;

void MainWindow::createUi() {
    bridge_ = new Bridge(this);
    connect(bridge_, &Bridge::toast, this, &MainWindow::handleToast);
    exposedBridge_ = new SddaiBridge(bridge_, this);

    auto splitter = new QSplitter(this);
    fsModel_ = new QFileSystemModel(this);
    fsModel_->setRootPath(QDir::currentPath());
    fsModel_->setFilter(QDir::NoDotAndDotDot | QDir::AllDirs | QDir::Files);

    tree_ = new QTreeView(splitter);
    tree_->setModel(fsModel_);
    tree_->setColumnWidth(0, 240);
    connect(tree_, &QTreeView::doubleClicked, [this](const QModelIndex &idx) {
        bridge_->openFile(fsModel_->filePath(idx));
    });

    webView_ = new QWebEngineView(splitter);
    splitter->setStretchFactor(1, 1);
    splitter->setStretchFactor(0, 0);
    setCentralWidget(splitter);

    // WebChannel hookup
    auto channel = new QWebChannel(webView_);
    channel->registerObject(QStringLiteral("bridge"), exposedBridge_);
    webView_->page()->setWebChannel(channel);
    webView_->setUrl(QUrl(QStringLiteral("qrc:/web/index.html")));

    statusBar()->showMessage(QStringLiteral("Ready"));
    projectLabel_ = new QLabel(tr("No project loaded"), this);
    statusBar()->addPermanentWidget(projectLabel_);
}

void MainWindow::createMenu() {
    auto fileMenu = menuBar()->addMenu(tr("&File"));
    auto openAct = fileMenu->addAction(tr("Open Project..."));
    openAct->setShortcut(QKeySequence::Open);
    connect(openAct, &QAction::triggered, this, &MainWindow::chooseProject);

    auto reloadAct = fileMenu->addAction(tr("Reload Graph"));
    connect(reloadAct, &QAction::triggered, [this]() {
        const QString root = fsModel_->rootPath();
        if (!root.isEmpty()) bridge_->openProject(root);
    });

    auto genAidocAct = fileMenu->addAction(tr("Generate AI Doc..."));
    connect(genAidocAct, &QAction::triggered, [this]() {
        const QString dir = QFileDialog::getExistingDirectory(this, tr("Target Project"), QString());
        if (dir.isEmpty()) return;
        if (exposedBridge_ && exposedBridge_->generateAidoc(dir)) {
            statusBar()->showMessage(tr("AI Doc scaffold generated: %1").arg(dir), 4000);
        } else {
            statusBar()->showMessage(tr("Generate AI Doc failed"), 5000);
        }
    });

    fileMenu->addSeparator();
    auto quitAct = fileMenu->addAction(tr("Quit"));
    quitAct->setShortcut(QKeySequence::Quit);
    connect(quitAct, &QAction::triggered, this, &QWidget::close);
}

void MainWindow::chooseProject() {
    const QString dir = QFileDialog::getExistingDirectory(this, tr("Open Project"), QString());
    if (!dir.isEmpty()) {
        openProject(dir);
    }
}

void MainWindow::openProject(const QString &path) {
    const auto idx = fsModel_->setRootPath(path);
    tree_->setRootIndex(idx);
    if (exposedBridge_) exposedBridge_->setProjectRoot(path);
    if (bridge_->openProject(path)) {
        statusBar()->showMessage(tr("Loaded project: %1").arg(path), 3000);
        projectLabel_->setText(QDir(path).dirName());
    } else {
        statusBar()->showMessage(tr("Failed to load project"), 5000);
    }
}

void MainWindow::handleToast(const QString &msg) {
    statusBar()->showMessage(msg, 5000);
}
