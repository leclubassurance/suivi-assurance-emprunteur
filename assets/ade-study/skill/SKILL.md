---
name: lcif-ade-presentation-pdf
description: "Analyse des offres de prêt, tableaux d'amortissement et devis de substitution d'assurance emprunteur, reconstitue les coûts mois par mois, vérifie les économies brutes et nettes, puis crée une présentation PDF client premium aux couleurs du Club Immobilier Français. Utiliser pour toute demande de présentation d'économies ADE, comparaison assurance actuelle/nouvelle assurance, étude Cardif/Kereis, dossier de substitution ou PDF commercial d'assurance emprunteur."
---

# Présentation PDF des économies ADE

Produire une étude client fiable, élégante et directement exploitable par Charles Victor pour Le Club Immobilier Français.

## Ressources obligatoires

- Lire [references/calculs.md](references/calculs.md) avant tout calcul.
- Lire [references/contenu-et-design.md](references/contenu-et-design.md) avant de rédiger ou générer le PDF.
- Lire [references/loi-lemoine.md](references/loi-lemoine.md) avant de rédiger la page juridique et vérifier les règles en vigueur sur des sources officielles françaises.
- Utiliser `assets/logo-lcif.png` pour l'identité visuelle.
- Utiliser `assets/cover-background.png` pour la couverture, sauf demande contraire.
- Prendre `assets/reference-presentation.pdf` comme référence de structure, de densité et de niveau de finition. Ne jamais recopier les données personnelles de ce dossier.

## Workflow

1. Lire intégralement les PDF fournis : devis, échéanciers, offre de prêt et captures utiles.
2. Identifier chaque prêt, la date d'effet, les échéances restantes, le coût actuel et le coût proposé.
3. Reconstituer les cotisations restantes mois par mois à partir de la date d'effet.
4. Consolider les résultats par prêt, par mois et par année contractuelle.
5. Vérifier les totaux contre les montants contractuels des deux assurances.
6. Distinguer clairement :
   - économie brute ;
   - frais de dossier de la nouvelle assurance ;
   - éventuels frais de courtage, uniquement s'ils figurent dans les documents ;
   - économie nette.
7. Comparer les garanties sans inventer d'équivalence. Signaler les conditions ou options à vérifier.
8. Générer le PDF A4 en français avec ReportLab ou un outil équivalent.
9. Rendre toutes les pages en images et les inspecter visuellement avant livraison.
10. Signaler explicitement les hypothèses sur l'alignement des échéances, les dates, les arrondis et les frais.

## Livrable PDF

Créer sept pages par défaut :

1. Couverture premium personnalisée avec nom du client, date d'étude, économie nette et pourcentage. Garder le visuel architectural nettement visible à droite ; limiter le voile sombre à la zone de texte à gauche.
2. Synthèse financière : actuelle, proposée, économie brute, frais de dossier, économie nette et ventilation par assuré ou par prêt.
3. Évolution annuelle : graphique du cumul net, comparaison des huit premières années et renvoi vers le détail annuel. Ne pas ajouter de tableau intermédiaire de périodes représentatives.
4. Détail complet : une ligne par année contractuelle sur toute la durée restante, avec `Année | Assurance actuelle | Nouvelle assurance | Économie nette | Cumul net`. Pour un prêt sur 25 ans, afficher exactement 25 lignes, pas 295 lignes mensuelles.
5. Garanties et accompagnement : tableau à trois colonnes `Garantie | Assurance actuelle | Nouvelle solution`, sans colonne « Niveau ».
6. Loi Lemoine : substitution, questionnaire de santé et éventuelles formalités médicales, avec une application personnalisée à chaque assuré.
7. Prochaines étapes et appel à l'action.

Adapter le nombre de pages si les données l'exigent, mais conserver cette hiérarchie.

## Règles éditoriales

- Ton : professionnel, rassurant, précis, jamais sur-vendeur.
- Ne pas afficher le nom commercial de l'assureur proposé sauf demande expresse.
- Décrire l'indépendance ainsi :
  « Notre rôle est de rechercher une solution adaptée à votre situation, en toute indépendance, tout en vous faisant bénéficier de conditions négociées et d'une étude rigoureuse. »
- Formuler les frais ainsi :
  « Après déduction des frais de dossier appliqués par la nouvelle assurance : [montant]. »
- Sous le tableau de synthèse, préciser uniquement :
  « La colonne “Frais” correspond aux frais de dossier appliqués par la nouvelle assurance sélectionnée. »
- Ne pas afficher dans le PDF une explication interne sur l'exclusion des frais de distribution ou l'absence de frais de courtage.
- Sur la page Loi Lemoine, ne pas écrire que le changement est « sans frais », car des frais d'accompagnement ou de dossier peuvent être appliqués séparément.
- Expliquer les formalités médicales en langage simple. Ne pas citer la convention AERAS ou le droit à l'oubli par leur nom sauf demande expresse du client.
- Ne pas afficher les sources juridiques, la date de consultation ou une note générale de responsabilité sur la page Loi Lemoine. Conserver uniquement le disclaimer standard du footer.
- Terminer le bloc santé par une consigne rassurante : l'assureur indiquera lui-même les justificatifs ou examens nécessaires et aucune démarche médicale n'est à anticiper tant qu'aucune demande n'est adressée.
- Pour la prise d'effet, préciser :
  « La mise en place intervient généralement sous un délai de deux à trois mois. »
- Call-to-action : répondre au courriel avec la copie recto-verso de la pièce d'identité et le RIB.
- Signer Charles Victor, Conseiller en assurance emprunteur.
- Footer :
  `Le Club Immobilier Français - 17 Passage Leroy, 44000 Nantes`
  `ORIAS 24002253 - Courtier indépendant`
- Ajouter : « Cette étude est établie à titre indicatif et n'a pas de valeur contractuelle. »

## Contrôle final

Ne pas livrer si l'une de ces vérifications échoue :

- somme mensuelle actuelle = coût restant actuel ;
- somme mensuelle proposée = coût total proposé ;
- économie brute = actuelle - proposée ;
- économie nette = économie brute - frais ponctuels ;
- cumul annuel final = économie nette totale ;
- tableau annuel exhaustif = une ligne par année contractuelle, sans doublon partiel sur la page du graphique ;
- page Loi Lemoine = règles vérifiées, profils personnalisés, aucun jargon inutile, aucune mention « sans frais » et aucune source affichée ;
- aucune donnée absente n'a été inventée ;
- aucune ligne n'est coupée ou superposée ;
- couverture, tableaux, graphique, footer et pagination sont nets ;
- le PDF final comporte les hypothèses nécessaires.
