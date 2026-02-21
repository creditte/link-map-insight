import React from "react";
import RecoveryScreen from "./RecoveryScreen";

interface State {
  hasError: boolean;
  error: string | null;
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error?.message ?? "Unknown error" };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <RecoveryScreen
          title="Application Error"
          message="An unexpected error occurred. Please reload or go to login."
          error={this.state.error ?? undefined}
        />
      );
    }
    return this.props.children;
  }
}
