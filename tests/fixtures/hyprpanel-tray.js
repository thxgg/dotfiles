// Installed HyprPanel MenuEntry, kept unpatched to test the regression.
var MenuEntry = ({ item, child }) => {
  let menu;
  const entryBinding = Variable.derive(
    [bind(item, "menuModel"), bind(item, "actionGroup")],
    (menuModel, actionGroup) => {
      if (menuModel === null) {
        return console.error(`Menu Model not found for ${item.id}`);
      }
      if (actionGroup === null) {
        return console.error(`Action Group not found for ${item.id}`);
      }
      menu = createMenu(menuModel, actionGroup);
    }
  );
  return /* @__PURE__ */ jsx2(
    "button",
    {
      cursor: "pointer",
      onClick: (self, event) => {
        if (isPrimaryClick(event)) {
          item.activate(0, 0);
        }
        if (isSecondaryClick(event)) {
          menu?.popup_at_widget(self, Gdk.Gravity.NORTH, Gdk.Gravity.SOUTH, null);
        }
        if (isMiddleClick(event)) {
          SystemUtilities.notify({ summary: "App Name", body: item.id });
        }
      },
      onDestroy: () => {
        menu?.destroy();
        entryBinding.drop();
      },
      children: child
    }
  );
};
