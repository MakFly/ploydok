// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { ApiErrorState } from "./ApiErrorState";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// ---------------------------------------------------------------------------
// ErrorBoundary
//
// React class component that wraps children and catches render-time errors.
// For TanStack Router route-level errors, prefer the `errorComponent` option
// on `createRootRoute` / `createFileRoute` (see __root.tsx). This class
// boundary is kept as a fallback for subtrees that are not covered by the
// router.
// ---------------------------------------------------------------------------

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error !== null) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center p-8">
          <ApiErrorState
            message={this.state.error.message}
            onRetry={this.handleReset}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
