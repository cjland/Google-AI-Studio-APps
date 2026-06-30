import React, { Component, ReactNode, ErrorInfo } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  componentStack: string;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: ''
  };

  static getDerivedStateFromError(
    error: Error
  ): Partial<AppErrorBoundaryState> {
    return {
      error
    };
  }

  componentDidCatch(
    error: Error,
    errorInfo: ErrorInfo
  ) {
    console.error(
      'UNHANDLED_REACT_RENDER_ERROR',
      {
        error,
        componentStack:
          errorInfo.componentStack
      }
    );

    this.setState({
      componentStack:
        errorInfo.componentStack || ''
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
          <div className="w-full max-w-3xl rounded-xl border border-red-900 bg-zinc-950 p-6 shadow-2xl">
            <h1 className="text-2xl font-bold text-red-400 mb-2">
              SetList client error
            </h1>

            <p className="text-zinc-400 mb-4">
              A browser-side React error occurred.
            </p>

            <div className="mb-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
                Error message
              </div>

              <pre className="rounded bg-black border border-zinc-800 p-4 text-sm text-red-300 whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
            </div>

            {this.state.error.stack && (
              <div className="mb-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
                  Stack
                </div>

                <pre className="max-h-64 overflow-auto rounded bg-black border border-zinc-800 p-4 text-xs text-zinc-300 whitespace-pre-wrap break-words">
                  {this.state.error.stack}
                </pre>
              </div>
            )}

            {this.state.componentStack && (
              <div className="mb-4">
                <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
                  React component stack
                </div>

                <pre className="max-h-64 overflow-auto rounded bg-black border border-zinc-800 p-4 text-xs text-zinc-300 whitespace-pre-wrap break-words">
                  {this.state.componentStack}
                </pre>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                className="rounded bg-primary px-4 py-2 font-medium text-white"
                onClick={() => {
                  window.location.reload();
                }}
              >
                Reload Application
              </button>

              <button
                type="button"
                className="rounded bg-zinc-800 px-4 py-2 font-medium text-white"
                onClick={() => {
                  this.setState({
                    error: null,
                    componentStack: ''
                  });
                }}
              >
                Try to Continue
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
