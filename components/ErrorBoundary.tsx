"use client";

import React from "react";
import { logger } from "@/lib/logger";

interface State {
  hasError: boolean;
  message: string | null;
}

/**
 * Top-level React error boundary. Logs to our app_logs sink and shows a
 * minimal recovery UI instead of a blank screen.
 */
export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error("react", "Unhandled render error", {
      error: { name: error.name, message: error.message, stack: error.stack },
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-red-900 shadow">
            <h1 className="mb-2 text-lg font-semibold">Something went wrong</h1>
            <p className="mb-4 text-sm">
              {this.state.message ?? "An unexpected error occurred."}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
