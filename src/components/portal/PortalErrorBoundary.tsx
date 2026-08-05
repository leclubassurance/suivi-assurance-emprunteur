import React, { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; onReset?: () => void };
type State = { error: Error | null };

/** Empêche un écran blanc total si le formulaire de reco plante. */
export default class PortalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[portal]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-[50vh] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-red-200 rounded-3xl p-8 text-center shadow-sm space-y-4">
          <p className="text-base font-black text-slate-900">Une erreur d&apos;affichage est survenue</p>
          <p className="text-sm text-slate-600 break-words">
            {this.state.error.message || "Erreur inconnue"}
          </p>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm px-5 py-3"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }
}
