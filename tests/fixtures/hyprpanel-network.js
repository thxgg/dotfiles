var wiredIcon = Variable("");
var wirelessIcon = Variable("");
var networkService2 = AstalNetwork2.get_default();
var wiredIconBinding;
var wirelessIconBinding;
var handleWiredIcon = () => {
  wiredIconBinding?.drop();
  wiredIconBinding = void 0;
  if (networkService2.wired === null) {
    return;
  }
  wiredIconBinding = Variable.derive([bind(networkService2.wired, "iconName")], (icon14) => {
    wiredIcon.set(icon14);
  });
};
var handleWirelessIcon = () => {
  wirelessIconBinding?.drop();
  wirelessIconBinding = void 0;
  if (networkService2.wifi === null) {
    return;
  }
  wirelessIconBinding = Variable.derive([bind(networkService2.wifi, "iconName")], (icon14) => {
    wirelessIcon.set(icon14);
  });
};
var formatFrequency = (frequency) => {
  return `${(frequency / 1e3).toFixed(2)}MHz`;
};
var formatWifiInfo = (wifi) => {
  return `Network: ${wifi.ssid} 
Signal Strength: ${wifi.strength}% 
Frequency: ${formatFrequency(wifi.frequency)}`;
};
Variable.derive([bind(networkService2, "state"), bind(networkService2, "connectivity")], () => {
  handleWiredIcon();
  handleWirelessIcon();
});

var networkService3 = AstalNetwork3.get_default();
var Network = () => {
  const iconBinding = Variable.derive(
    [bind(networkService3, "primary"), bind(wiredIcon), bind(wirelessIcon)],
    (primaryNetwork, wiredIcon2, wifiIcon) => {
      return primaryNetwork === AstalNetwork3.Primary.WIRED ? wiredIcon2 : wifiIcon;
    }
  );
  return iconBinding;
};
