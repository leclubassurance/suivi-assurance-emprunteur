import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, Loader2 } from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import CalBookingButton from "../ui/CalBookingButton";
import { LCIF_LOGO_URL } from "../../../shared/apporteurBrand";
import "../../styles/client-landing-preview.css";

type RecentStudy = {
  dossierId: string;
  dateLabel: string;
  grossSavingsEur: number;
  savingLabel: string;
  monthlyBeforeEur: number | null;
  monthlyAfterEur: number | null;
  savingsPercent: number | null;
};

function formatMonthly(eur: number): string {
  return `${eur.toLocaleString("fr-FR", {
    minimumFractionDigits: Number.isInteger(eur) ? 0 : 2,
    maximumFractionDigits: 2,
  })} €`;
}

function BrandMark() {
  return (
    <a className="brand" href="#top" aria-label="Le Club Immobilier Français">
      <img className="brand-logo" src={LCIF_LOGO_URL} alt="Le Club Immobilier Français" />
      <span className="brand-rule" />
      <span className="brand-meta">
        ASSURANCE
        <br />
        EMPRUNTEUR
      </span>
    </a>
  );
}

export default function AdminClientLandingPreview({
  onBack,
  onStartStudy,
}: {
  onBack: () => void;
  onStartStudy: () => void;
}) {
  const [studies, setStudies] = useState<RecentStudy[]>([]);
  const [loadingStudies, setLoadingStudies] = useState(true);
  const [studiesError, setStudiesError] = useState<string | null>(null);
  const [monthly, setMonthly] = useState(79);
  const [years, setYears] = useState(18);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingStudies(true);
      setStudiesError(null);
      try {
        const res = await adminFetch("/api/admin/client-landing-preview/recent-studies");
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Impossible de charger les économies.");
        }
        if (!cancelled) setStudies(Array.isArray(data.studies) ? data.studies : []);
      } catch (err: any) {
        if (!cancelled) setStudiesError(err?.message || "Erreur réseau");
      } finally {
        if (!cancelled) setLoadingStudies(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const estimate = useMemo(() => {
    const newMonthly = Math.max(18, Math.round(monthly * 0.43));
    return {
      newMonthly,
      monthlySaving: monthly - newMonthly,
      totalSaving: (monthly - newMonthly) * years * 12,
    };
  }, [monthly, years]);

  const euros = (value: number) =>
    new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value);

  const heroSaving = studies[0];
  const heroBefore =
    heroSaving?.monthlyBeforeEur != null && heroSaving.monthlyBeforeEur > 0
      ? heroSaving.monthlyBeforeEur
      : null;
  const heroAfter =
    heroSaving?.monthlyAfterEur != null && heroSaving.monthlyAfterEur > 0
      ? heroSaving.monthlyAfterEur
      : null;
  const heroPercent =
    heroSaving?.savingsPercent != null && heroSaving.savingsPercent > 0
      ? heroSaving.savingsPercent
      : heroBefore != null && heroAfter != null && heroBefore > heroAfter
        ? Math.round(((heroBefore - heroAfter) / heroBefore) * 100)
        : null;

  return (
    <div className="client-landing-preview">
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "#0b1633",
          color: "white",
          padding: "10px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontFamily: "Poppins, Arial, sans-serif",
          fontSize: 12,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "transparent",
            border: "1px solid rgba(255,255,255,.25)",
            color: "white",
            borderRadius: 999,
            padding: "8px 14px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Retour admin
        </button>
        <span style={{ opacity: 0.85, textAlign: "right" }}>
          Preview landing client · non publiée
        </span>
      </div>

      <main>
        <nav className="nav shell" aria-label="Navigation principale">
          <BrandMark />
          <div className="nav-links">
            <a href="#methode">Notre méthode</a>
            <a href="#confiance">Pourquoi nous</a>
            <a href="#faq">Vos questions</a>
          </div>
          <button type="button" className="button button-small" onClick={onStartStudy}>
            Recevoir mon étude <ArrowUpRight className="btn-arrow" aria-hidden />
          </button>
        </nav>

        <section className="hero shell" id="top">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="pulse" /> Courtier indépendant · ORIAS 24002253
            </div>
            <h1>
              Gardez votre prêt.
              <br />
              <em>Payez moins pour l’assurer.</em>
            </h1>
            <p className="hero-lead">
              Nous renégocions votre assurance emprunteur à garanties équivalentes. Vous gardez votre
              prêt. Vous récupérez du pouvoir d’achat.
            </p>
            <div className="hero-actions">
              <button type="button" className="button" onClick={onStartStudy}>
                Calculer mes économies <ArrowUpRight className="btn-arrow" aria-hidden />
              </button>
              <CalBookingButton className="text-link cal-text-link">
                Prendre rendez-vous <span>→</span>
              </CalBookingButton>
            </div>
            <div className="trust-line">
              <span>
                <span className="trust-chip" aria-hidden>
                  <Check strokeWidth={2.75} />
                </span>
                Étude gratuite
              </span>
              <span>
                <span className="trust-chip" aria-hidden>
                  <Check strokeWidth={2.75} />
                </span>
                Sans engagement
              </span>
              <span>
                <span className="trust-chip" aria-hidden>
                  <Check strokeWidth={2.75} />
                </span>
                Réponse sous 48h
              </span>
            </div>
          </div>

          <div className="hero-visual" aria-label="Exemple réel d'économie">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            {heroBefore != null ? (
              <div className="saving-card card-before">
                <span>Avant</span>
                <strong>{formatMonthly(heroBefore)}</strong>
                <small>par mois</small>
              </div>
            ) : null}
            {heroAfter != null ? (
              <div className="saving-card card-after">
                <span>Après</span>
                <strong>{formatMonthly(heroAfter)}</strong>
                <small>par mois</small>
              </div>
            ) : null}
            <div className="hero-number">
              <span>ÉCONOMIE CONSTATÉE</span>
              <strong>
                {heroSaving
                  ? `${euros(heroSaving.grossSavingsEur)} €`
                  : "—"}
              </strong>
              <small>
                {heroSaving
                  ? `Dossier réel anonymisé · étude du ${heroSaving.dateLabel}`
                  : "En attente d’études récentes"}
              </small>
            </div>
            {heroPercent != null ? (
              <div className="hero-stamp">
                −{heroPercent}%
                <small>sur la cotisation</small>
              </div>
            ) : null}
          </div>
        </section>

        <section className="proof-strip">
          <div className="shell proof-grid">
            <div>
              <strong>100%</strong>
              <span>des garanties préservées</span>
            </div>
            <div>
              <strong>0 €</strong>
              <span>de frais si vous n’économisez pas</span>
            </div>
            <div>
              <strong>5 min</strong>
              <span>pour déposer votre demande</span>
            </div>
            <div>
              <strong>48h</strong>
              <span>pour recevoir votre étude</span>
            </div>
          </div>
        </section>

        <aside className="second-look shell" aria-label="Votre assurance a déjà été renégociée">
          <div className="second-look-icon">↻</div>
          <div>
            <strong>Vous avez déjà renégocié votre assurance ?</strong>
            <p>
              Excellent réflexe. Le marché et les tarifs évoluent : de nouvelles économies peuvent
              encore être disponibles aujourd’hui.
            </p>
          </div>
          <button type="button" className="text-link" onClick={onStartStudy}>
            Vérifier à nouveau <span>→</span>
          </button>
        </aside>

        <section className="recent-results" aria-labelledby="recent-results-title">
          <div className="shell recent-results-heading">
            <div>
              <div className="section-label">Des résultats concrets</div>
              <h2 id="recent-results-title">
                Les dernières économies
                <br />
                <em>identifiées pour nos clients.</em>
              </h2>
            </div>
            <p>Économies constatées sur des dossiers réels, anonymisés.</p>
          </div>

          {loadingStudies ? (
            <div className="shell" style={{ display: "flex", alignItems: "center", gap: 10, color: "#697187" }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement des économies…
            </div>
          ) : studiesError ? (
            <div className="shell" style={{ color: "#b42318", fontSize: 14 }}>
              {studiesError}
            </div>
          ) : studies.length === 0 ? (
            <div className="shell" style={{ color: "#697187", fontSize: 14 }}>
              Aucune étude récente à afficher pour le moment.
            </div>
          ) : (
            <div className="marquee" role="region" aria-label="Dernières études réalisées">
              <div className="marquee-fade marquee-fade-left" />
              <div className="marquee-fade marquee-fade-right" />
              <div className="marquee-track">
                {[0, 1].map((setIndex) => (
                  <div className="marquee-set" key={setIndex} aria-hidden={setIndex === 1}>
                    {studies.map((study, index) => (
                      <article
                        className={`result-tile tile-${(index % 4) + 1}`}
                        key={`${setIndex}-${study.dossierId}`}
                      >
                        <div className="tile-top">
                          <span className="tile-status">
                            <i /> ÉTUDE RÉALISÉE
                          </span>
                          <span className="tile-index">{String(index + 1).padStart(2, "0")}</span>
                        </div>
                        <div className="tile-date">Le {study.dateLabel}</div>
                        <div className="tile-saving">
                          <strong>{study.savingLabel}</strong>
                          <span>d’économies identifiées</span>
                        </div>
                        <div className="tile-line">
                          <span />
                        </div>
                      </article>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="section shell intro" id="confiance">
          <div className="section-label">Pourquoi changer ?</div>
          <div className="intro-content">
            <h2>
              Votre banque vous a proposé une assurance.
              <br />
              Elle ne vous a pas forcément proposé <em>la meilleure.</em>
            </h2>
            <p>
              Depuis la loi Lemoine, vous pouvez changer d’assurance à tout moment, sans modifier
              votre crédit. Nous trouvons le contrat qui protège aussi bien — ou mieux — pour un
              coût souvent bien inférieur.
            </p>
          </div>
        </section>

        <section className="section section-dark" id="etude">
          <div className="shell calculator-grid">
            <div className="calculator-copy">
              <div className="eyebrow eyebrow-light">Estimation instantanée</div>
              <h2>
                Et si votre assurance coûtait <em>deux fois moins cher ?</em>
              </h2>
              <p>
                Ajustez les deux curseurs. Cette estimation indicative vous donne un premier ordre
                de grandeur.
              </p>
              <div className="range-group">
                <div className="range-head">
                  <label htmlFor="monthly-preview">Cotisation actuelle</label>
                  <strong>{monthly} € / mois</strong>
                </div>
                <input
                  id="monthly-preview"
                  type="range"
                  min={30}
                  max={200}
                  value={monthly}
                  onChange={(e) => setMonthly(Number(e.target.value))}
                />
              </div>
              <div className="range-group">
                <div className="range-head">
                  <label htmlFor="years-preview">Durée restante</label>
                  <strong>{years} ans</strong>
                </div>
                <input
                  id="years-preview"
                  type="range"
                  min={3}
                  max={25}
                  value={years}
                  onChange={(e) => setYears(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="result-card">
              <div className="result-top">
                <span>Votre économie potentielle</span>
                <span className="live-dot">ESTIMATION</span>
              </div>
              <strong className="result-number">{euros(estimate.totalSaving)} €</strong>
              <span className="result-caption">sur la durée restante du prêt</span>
              <div className="result-comparison">
                <div>
                  <small>Aujourd’hui</small>
                  <strong>{monthly} €</strong>
                  <span>/ mois</span>
                </div>
                <div className="result-arrow">→</div>
                <div>
                  <small>Estimation</small>
                  <strong>{estimate.newMonthly} €</strong>
                  <span>/ mois</span>
                </div>
              </div>
              <button type="button" className="button button-white" onClick={onStartStudy}>
                Obtenir mon étude précise <ArrowUpRight className="btn-arrow" aria-hidden />
              </button>
              <small className="fine-print">Gratuite, confidentielle et sans engagement.</small>
            </div>
          </div>
        </section>

        <section className="section shell method" id="methode">
          <div className="section-heading">
            <div>
              <div className="section-label">Simple par conception</div>
              <h2>
                Deux documents pour démarrer.
                <br />
                <em>Nous vous guidons ensuite.</em>
              </h2>
            </div>
            <p>
              Après quelques informations personnelles simples, nous vous accompagnons du calcul à
              la substitution.
            </p>
          </div>
          <div className="steps">
            <article>
              <span className="step-number">01</span>
              <div className="step-icon">↥</div>
              <h3>Déposez votre dossier</h3>
              <p>
                Ajoutez votre offre de prêt, votre tableau d’amortissement et complétez quelques
                informations sur les emprunteurs.
              </p>
              <span className="step-time">≈ 5 minutes</span>
            </article>
            <article>
              <span className="step-number">02</span>
              <div className="step-icon">⌕</div>
              <h3>Nous comparons</h3>
              <p>
                Nous vérifions les garanties et comparons une très large sélection d’assurances
                disponibles sur le marché.
              </p>
              <span className="step-time">Sous 48 heures</span>
            </article>
            <article>
              <span className="step-number">03</span>
              <div className="step-icon">✓</div>
              <h3>Vous décidez</h3>
              <p>
                Vous recevez une étude lisible. Si elle vous convient, nous gérons les démarches.
              </p>
              <span className="step-time">Sans engagement</span>
            </article>
          </div>
        </section>

        <section className="section shell testimonial">
          <div className="quote-mark">“</div>
          <blockquote>
            <p>
              Notre cœur de métier, c’est l’immobilier. Nous avons vu trop de clients laisser des
              milliers d’euros sur la table avec leur assurance emprunteur. Nous avons décidé d’y
              remédier.
            </p>
            <footer>
              <span className="avatar">CV</span>
              <div>
                <strong>Charles Victor</strong>
                <span>Fondateur du Club Immobilier Français</span>
              </div>
            </footer>
          </blockquote>
          <div className="quote-saving">
            <small>Notre engagement</small>
            <strong>Vos intérêts</strong>
            <span>avant tout, à chaque étape</span>
          </div>
        </section>

        <section className="section shell values">
          <div className="section-heading">
            <div>
              <div className="section-label">Vos intérêts d’abord</div>
              <h2>
                Un courtier qui gagne
                <br />
                <em>quand vous gagnez.</em>
              </h2>
            </div>
          </div>
          <div className="value-grid">
            <article>
              <span>01</span>
              <h3>Une comparaison large</h3>
              <p>
                Nous explorons la majorité des solutions accessibles sur le marché pour défendre
                votre intérêt, pas celui de votre banque.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>Alignés</h3>
              <p>
                Notre rémunération dépend des économies réalisées. Aucun résultat, aucun frais pour
                vous.
              </p>
            </article>
            <article>
              <span>03</span>
              <h3>Experts des profils</h3>
              <p>
                Chaque assureur privilégie certains profils. Nous connaissons ces critères pour
                orienter votre dossier vers les offres les plus pertinentes et compétitives.
              </p>
            </article>
            <article>
              <span>04</span>
              <h3>Réglementés</h3>
              <p>
                Immatriculés à l’ORIAS, nous appliquons strictement les exigences de garanties et de
                confidentialité.
              </p>
            </article>
          </div>
        </section>

        <section className="section shell faq" id="faq">
          <div>
            <div className="section-label">Questions fréquentes</div>
            <h2>
              Tout ce qu’il faut savoir,
              <br />
              <em>sans petites lignes.</em>
            </h2>
          </div>
          <div className="faq-list">
            <details>
              <summary>
                Ma banque peut-elle refuser le changement ?<span>+</span>
              </summary>
              <p>
                Elle ne peut pas le refuser si le nouveau contrat présente un niveau de garanties
                équivalent à celui exigé pour votre prêt.
              </p>
            </details>
            <details>
              <summary>
                Est-ce vraiment gratuit et sans engagement ?<span>+</span>
              </summary>
              <p>
                Oui. L’étude est gratuite et ne vous engage à rien. Vous restez libre d’accepter ou
                non la proposition.
              </p>
            </details>
            <details>
              <summary>
                Quand puis-je changer d’assurance ?<span>+</span>
              </summary>
              <p>
                À tout moment depuis l’entrée en vigueur de la loi Lemoine, sans frais ni pénalité.
              </p>
            </details>
            <details>
              <summary>
                Quels documents faut-il préparer ?<span>+</span>
              </summary>
              <p>
                Votre offre de prêt et votre tableau d’amortissement à jour permettent de démarrer.
                Quelques informations personnelles sur les emprunteurs seront ensuite nécessaires
                pour affiner l’étude.
              </p>
            </details>
          </div>
        </section>

        <section className="final-cta shell">
          <div className="cta-glow" />
          <div className="eyebrow eyebrow-light">Votre étude en moins de 5 minutes</div>
          <h2>
            Découvrez ce que votre assurance
            <br />
            pourrait vous rendre.
          </h2>
          <p>Deux documents pour démarrer. Quelques informations. Nous comparons pour vous.</p>
          <div className="final-cta-actions">
            <button type="button" className="button button-white" onClick={onStartStudy}>
              Commencer mon étude gratuite <ArrowUpRight className="btn-arrow" aria-hidden />
            </button>
            <CalBookingButton className="button button-ghost">Prendre rendez-vous</CalBookingButton>
          </div>
        </section>

        <footer className="footer shell">
          <BrandMark />
          <div className="footer-center">
            Courtier indépendant · ORIAS 24002253
            <br />© 2026 Le Club Immobilier Français
          </div>
          <div className="footer-links">
            <a href="#faq">Confidentialité</a>
            <a href="#faq">Mentions légales</a>
          </div>
        </footer>
      </main>
    </div>
  );
}
