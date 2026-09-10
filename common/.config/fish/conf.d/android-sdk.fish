set -l android_sdk "$HOME/Android/Sdk"
if test (uname) = Darwin
    set android_sdk "$HOME/Library/Android/sdk"
end

if test -d "$android_sdk"
    set -gx ANDROID_HOME "$android_sdk"
    set -gx ANDROID_SDK_ROOT "$android_sdk"
    for sdk_bin in cmdline-tools/latest/bin platform-tools emulator
        if test -d "$android_sdk/$sdk_bin"
            fish_add_path --global "$android_sdk/$sdk_bin"
        end
    end
end
