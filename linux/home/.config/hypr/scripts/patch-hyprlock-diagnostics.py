#!/usr/bin/env python3
"""Instrument a disposable source export only. No authentication or pacing changes."""
from pathlib import Path
import sys

HEADER = r'''#pragma once
#include "Log.hpp"
#include <algorithm>
#include <chrono>
#include <string>

// CPU wall-clock timings only: no glFinish, GPU queries, or synchronous mpv reads.
// Log at most once per second per metric, not once per rendered frame.
class CPerfMetric {
  public:
    using Clock = std::chrono::steady_clock;
    void add(const std::string& name, double milliseconds) {
        const auto now = Clock::now();
        if (start == Clock::time_point{}) start = now;
        count++;
        total += milliseconds;
        maximum = std::max(maximum, milliseconds);
        const double seconds = std::chrono::duration<double>(now - start).count();
        if (seconds < 1.0) return;
        Log::logger->log(Log::INFO, "[perf] {} samples={} window_s={:.3f} mean_ms={:.3f} max_ms={:.3f}",
                         name, count, seconds, total / count, maximum);
        count = 0;
        total = maximum = 0;
        start = now;
    }
  private:
    Clock::time_point start{};
    unsigned count = 0;
    double total = 0, maximum = 0;
};

class CPerfScope {
  public:
    CPerfScope(CPerfMetric& metric, std::string name) : metric(metric), name(std::move(name)), start(CPerfMetric::Clock::now()) {}
    ~CPerfScope() {
        metric.add(name, std::chrono::duration<double, std::milli>(CPerfMetric::Clock::now() - start).count());
    }
  private:
    CPerfMetric& metric;
    std::string name;
    CPerfMetric::Clock::time_point start;
};
'''

PATCHES = {
    'src/renderer/MpvVideo.hpp': [
        ('#include "Framebuffer.hpp"', '#include "Framebuffer.hpp"\n#include "../helpers/PerfDiagnostics.hpp"'),
        ('    mpv_handle*         m_mpv   = nullptr;', '''    CPerfMetric         m_perfFrame, m_perfRender;
    std::string         m_diagHwdec = "unknown", m_diagDecoder = "unknown";
    int64_t             m_diagVoDrops = -1, m_diagDecoderDrops = -1;
    std::chrono::steady_clock::time_point m_diagLastReport{};
    mpv_handle*         m_mpv   = nullptr;'''),
    ],
    'src/renderer/MpvVideo.cpp': [
        ('    mpv_request_log_messages(m_mpv, "error");', '''    mpv_request_log_messages(m_mpv, "error");
    // Asynchronous property notifications avoid blocking the shared render thread.
    for (const auto* property : {"hwdec-current", "video-codec", "frame-drop-count", "decoder-frame-drop-count"}) {
        const bool counter = std::string(property).find("drop-count") != std::string::npos;
        if (mpv_observe_property(m_mpv, 0, property, counter ? MPV_FORMAT_INT64 : MPV_FORMAT_STRING) < 0)
            Log::logger->log(Log::WARN, "[perf] unavailable mpv property: {}", property);
    }
    Log::logger->log(Log::INFO, "[perf] GL renderer={}", reinterpret_cast<const char*>(glGetString(GL_RENDERER)));'''),
        ('        switch (ev->event_id) {', '''        switch (ev->event_id) {
            case MPV_EVENT_PROPERTY_CHANGE: {
                const auto* p = static_cast<mpv_event_property*>(ev->data);
                if (!p->data) break;
                const std::string name = p->name;
                if (p->format == MPV_FORMAT_STRING) {
                    const char* value = *static_cast<char**>(p->data);
                    if (name == "hwdec-current") m_diagHwdec = value ? value : "unknown";
                    if (name == "video-codec") m_diagDecoder = value ? value : "unknown";
                } else if (p->format == MPV_FORMAT_INT64) {
                    if (name == "frame-drop-count") m_diagVoDrops = *static_cast<int64_t*>(p->data);
                    if (name == "decoder-frame-drop-count") m_diagDecoderDrops = *static_cast<int64_t*>(p->data);
                }
                break;
            }'''),
        ('    pumpEvents();\n    if (m_failed)', '''    const std::string diagnosticId = std::to_string((int)size.x) + "x" + std::to_string((int)size.y);
    CPerfScope frameScope(m_perfFrame, "video-update/" + diagnosticId);
    pumpEvents();
    const auto diagnosticNow = std::chrono::steady_clock::now();
    if (diagnosticNow - m_diagLastReport >= std::chrono::seconds(1)) {
        Log::logger->log(Log::INFO, "[perf] video={} hwdec={} codec={} vo_drops={} decoder_drops={}",
                         diagnosticId, m_diagHwdec, m_diagDecoder, m_diagVoDrops, m_diagDecoderDrops);
        m_diagLastReport = diagnosticNow;
    }
    if (m_failed)'''),
        ('        const int RENDERED = mpv_render_context_render(m_glCtx, params);', '''        int RENDERED;
        {
            CPerfScope renderScope(m_perfRender, "mpv-render/" + diagnosticId);
            RENDERED = mpv_render_context_render(m_glCtx, params);
        }'''),
    ],
    'src/core/LockSurface.hpp': [
        ('#include "../helpers/Math.hpp"', '#include "../helpers/Math.hpp"\n#include "../helpers/PerfDiagnostics.hpp"'),
        ('    bool                          needsFrame = false;', '''    CPerfMetric                   m_perfWidgets, m_perfSwap, m_perfCallback;
    CPerfMetric::Clock::time_point m_diagLastCallback{};
    bool                          needsFrame = false;'''),
    ],
    'src/core/LockSurface.cpp': [
        ('    const auto FEEDBACK = g_pRenderer->renderLock(*this);', '''    const auto output = m_outputRef.lock();
    const std::string diagnosticOutput = output ? output->stringPort : "unknown";
    const auto FEEDBACK = [&]() {
        CPerfScope scope(m_perfWidgets, "widgets/" + diagnosticOutput);
        return g_pRenderer->renderLock(*this);
    }();'''),
        ('        m_lastFrameTime = frameTime;', '''        const auto now = CPerfMetric::Clock::now();
        if (m_diagLastCallback != CPerfMetric::Clock::time_point{}) {
            const auto output = m_outputRef.lock();
            m_perfCallback.add("callback-gap/" + (output ? output->stringPort : std::string("unknown")),
                               std::chrono::duration<double, std::milli>(now - m_diagLastCallback).count());
        }
        m_diagLastCallback = now;
        m_lastFrameTime = frameTime;'''),
        ('    if (!g_pEGL->swapBuffers(eglSurface)) {', '''    const bool swapOK = [&]() {
        CPerfScope scope(m_perfSwap, "swap/" + diagnosticOutput);
        return g_pEGL->swapBuffers(eglSurface);
    }();
    if (!swapOK) {'''),
    ],
}


def apply(root):
    header = root / 'src/helpers/PerfDiagnostics.hpp'
    if header.exists():
        raise RuntimeError('Diagnostic header already exists; use a fresh source export')
    changed = {}
    # Validate every target before writing any source files.
    for relative, edits in PATCHES.items():
        source = (root / relative).read_text()
        for old, new in edits:
            if source.count(old) != 1:
                raise RuntimeError(f'Expected one diagnostic patch target in {relative}: {old}')
            source = source.replace(old, new)
        changed[root / relative] = source
    header.write_text(HEADER)
    for path, source in changed.items():
        path.write_text(source)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: patch-hyprlock-diagnostics.py /path/to/disposable/source')
    apply(Path(sys.argv[1]))
