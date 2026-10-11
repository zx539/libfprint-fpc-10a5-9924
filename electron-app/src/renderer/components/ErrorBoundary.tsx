import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: "" };
  static getDerivedStateFromError(error: Error) { return { hasError: true, message: error.message }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Fingerprint Manager UI error", error, info); }
  render() {
    if (!this.state.hasError) return this.props.children;
    return <main className="grid h-screen place-items-center bg-canvas p-6 text-center"><div className="panel max-w-md"><h1 className="text-xl font-bold">界面暂时无法显示</h1><p className="mt-2 text-muted">{this.state.message || "发生未知错误"}</p><button className="primary-button mt-5" onClick={() => this.setState({ hasError: false, message: "" })}>重新加载</button></div></main>;
  }
}
