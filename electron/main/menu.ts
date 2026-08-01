import { Menu, dialog, BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { createProjectFromTemplate, getPlaygroundUrl, restartPlayground } from "./playground";
import { disposeCodingAgent } from "./coding-agent";
import { clearUndoSnapshot } from "./playground-snapshot";

type NewProjectHooks = {
  getWindow: () => BrowserWindow | null;
};

export function installAppMenu(hooks: NewProjectHooks): void {
  const isMac = process.platform === "darwin";

  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        label: "New Project",
        accelerator: "CmdOrCtrl+N",
        click: () => {
          void runNewProject(hooks);
        },
      },
      { type: "separator" },
      isMac ? { role: "close" } : { role: "quit" },
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: "Scribe",
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    fileMenu,
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, ...(isMac ? [{ role: "front" as const }] : [])],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function runNewProject(hooks: NewProjectHooks): Promise<void> {
  const win = hooks.getWindow();
  const confirmOpts = {
    type: "warning" as const,
    buttons: ["Cancel", "Create New Project"],
    defaultId: 1,
    cancelId: 0,
    title: "New Project",
    message: "Create a new project from the template?",
    detail:
      "This replaces the current playground with a fresh copy of playground-template. Unsaved voice-built work in playground/ will be lost.",
  };
  const result = win
    ? await dialog.showMessageBox(win, confirmOpts)
    : await dialog.showMessageBox(confirmOpts);

  if (result.response !== 1) return;

  try {
    win?.webContents.send("chat:message", {
      role: "system",
      text: "Creating new project from template…",
      at: Date.now(),
    });

    await disposeCodingAgent();
    await createProjectFromTemplate();
    clearUndoSnapshot();
    const url = await restartPlayground();

    win?.webContents.send("project:reset", { playgroundUrl: url || getPlaygroundUrl() });
    win?.webContents.send("chat:message", {
      role: "system",
      text: "New project ready. Speak the app into existence.",
      at: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create project";
    win?.webContents.send("chat:message", {
      role: "system",
      text: `New Project failed: ${message}`,
      at: Date.now(),
    });
    const errorOpts = {
      type: "error" as const,
      message: "New Project failed",
      detail: message,
    };
    if (win) await dialog.showMessageBox(win, errorOpts);
    else await dialog.showMessageBox(errorOpts);
  }
}
