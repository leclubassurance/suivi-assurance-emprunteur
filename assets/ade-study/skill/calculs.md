# Règles de calcul

## Sources prioritaires

1. Devis de la nouvelle assurance : date d'effet, coûts, frais, garanties et coût des huit premières années.
2. Tableaux d'amortissement : cotisations actuelles restantes et dates d'échéance.
3. Offre de prêt : caractéristiques contractuelles et garanties initiales.
4. Captures bancaires : confirmation du capital restant dû, sans remplacer les échéanciers.

## Période étudiée

- Commencer à la date d'effet annoncée.
- Si la date d'effet ne coïncide pas avec l'échéance du prêt, expliquer l'alignement retenu.
- Ne compter que les cotisations qui restent dues après la substitution.
- Conserver la précision complète pendant les calculs et arrondir l'affichage à deux décimales.

## Formules

Pour chaque prêt et chaque mois :

`économie mensuelle = assurance actuelle - nouvelle assurance`

`économie cumulée = somme des économies mensuelles`

Par année contractuelle :

`coût annuel = somme des mois de l'année contractuelle`

`économie annuelle = coût annuel actuel - coût annuel proposé`

`économie brute totale = coût actuel restant - coût proposé total`

`économie nette = économie brute totale - frais ponctuels documentés`

`taux d'économie net = économie nette / coût actuel restant`

## Frais

- Ne jamais inventer un frais.
- Identifier son bénéficiaire et son moment de paiement quand le devis le précise.
- Par défaut dans l'étude commerciale LCIF, la colonne `Frais` correspond aux frais de dossier appliqués par la nouvelle assurance sélectionnée.
- Ne pas intégrer les frais de distribution au calcul de l'économie lorsqu'ils sont remplacés ou traités séparément par le courtage. En cas d'ambiguïté, demander la règle métier avant de produire le PDF.
- Ne pas intégrer de frais de courtage tant que leur montant n'est pas fourni.
- Ne déduire qu'une fois les frais ponctuels.
- Si un frais est déjà inclus dans le coût total proposé, ne pas le déduire une seconde fois.
- Expliquer toute ambiguïté dans les hypothèses.

## Restitution annuelle

- Effectuer les calculs et contrôles mois par mois en interne.
- Regrouper ensuite les flux par année contractuelle pour le PDF client.
- Afficher une ligne par année sur toute la durée restante : coût actuel, coût proposé, économie nette annuelle et cumul net.
- Affecter les frais de dossier à la première année uniquement.
- Ne pas produire un tableau mensuel de plusieurs centaines de lignes sauf demande expresse.

## Concordance

Tolérance cible : 0,01 € après arrondi final. Si les tableaux sources créent un écart :

1. vérifier les dates et le nombre d'échéances ;
2. vérifier la première et la dernière cotisation ;
3. vérifier si les frais sont inclus ;
4. isoler l'écart et le signaler, sans forcer artificiellement la concordance.
