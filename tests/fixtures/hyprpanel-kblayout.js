// Installed HyprPanel keyboard module excerpt. Keep patch targets unchanged.
const layoutMap = {
  "English (US)": "US",
  "Bulgarian (traditional phonetic)": "BG (Phonetic)",
  "Unknown Layout": "Unknown"
};
var getKeyboardLayout = (layoutData, format4) => {
  const hyprctlDevices = JSON.parse(layoutData);
  const keyboards = hyprctlDevices["keyboards"];
  if (keyboards.length === 0) {
    return format4 === "code" ? "Unknown" : "Unknown Layout";
  }
  let mainKb = keyboards.find((kb) => kb.main);
  if (!mainKb) {
    mainKb = keyboards[keyboards.length - 1];
  }
  if (!isValidLayout(mainKb.active_keymap)) {
    return layoutMap["Unknown Layout"];
  }
  const layout = mainKb.active_keymap;
  const foundLayout = layoutMap[layout];
  return format4 === "code" ? foundLayout ?? layout : layout;
};
function isValidLayout(kbLayout) {
  if (!Object.keys(layoutMap).includes(kbLayout)) {
    return false;
  }
  return true;
}
function setLabel(self) {
  try {
    const devices = hyprlandService4.message("j/devices");
    self.label = getKeyboardLayout(devices, labelType.get());
  } catch (error) {
    console.error(error);
  }
}
var KbInput = () => {
  const keyboardModule = Module({
    labelHook: (self) => {
      useHook(
        self,
        hyprlandService4,
        () => {
          setLabel(self);
        },
        "keyboard-layout"
      );
      useHook(self, labelType, () => {
        setLabel(self);
      });
    },
  });
  return keyboardModule;
};
