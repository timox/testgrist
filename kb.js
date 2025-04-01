const STATUTS = [
    { id: 'À faire', libelle: 'À faire', classe: 'a-faire' },
    { id: 'En cours', libelle: 'En cours', classe: 'en-cours' },
    { id: 'En attente', libelle: 'En attente', classe: 'en-attente' },
    { id: 'Bloqué', libelle: 'Bloqué', classe: 'bloque' },
    { id: 'Validation', libelle: 'Validation', classe: 'validation' },
    { id: 'Terminé', libelle: 'Terminé', classe: 'termine' }
];

const TABLE_ID = "Ssir_principale_task";
const BUREAUX = ['Exploit', 'Réseau', 'BDD', 'Chef SSIR'];
const RESPONSABLES = ['Alex', 'Timothée', 'Isabelle', 'Chloé', 'Paul', 'Théo', 'Gaël', 'Thomas', 'Elie', 'Landry'];
let isUpdating = false;

class KanbanManager {
    constructor() {
        this.kanban = null;
        this.currentRecords = [];
        this.modal = null;
        this.currentTaskId = null;
    }

    async init() {
        await this.initGrist();
        this.initModal();
        this.initKanban();
        this.initEventListeners();
    }

    async initGrist() {
        await grist.ready({
            requiredAccess: 'full',
            columns: ['id', 'titre', 'description', 'statut', 'bureau', 'qui', 'urgence', 'impact']
        });

        const data = await grist.docApi.fetchTable(TABLE_ID);
        this.currentRecords = data.id.map((id, index) => ({
            id: id,
            titre: data.titre[index] || 'Sans titre',
            statut: data.statut[index] || 'À faire',
            bureau: this.nettoyerListe(data.bureau[index], false),
            qui: this.nettoyerListe(data.qui[index], false),
            urgence: data.urgence[index] || 'Courte',
            impact: data.impact[index] || 'Modéré'
        }));
    }

    nettoyerListe(data, filtrerL = true) {
        if (!data) return [];
        const raw = Array.isArray(data) ? data : String(data).split(',').map(s => s.trim());
        return filtrerL ? raw.filter(item => item !== "L") : raw;
    }

    initKanban() {
        this.kanban = new jKanban({
            element: '#kanban-container',
            gutter: '15px',
            widthBoard: '300px',
           itemHandleOptions: {
            enabled: true,
            handleClass: 'drag-handle',
            customDragHandler: false // Important pour jKanban 1.3.1
             },
            boards: STATUTS.map(statut => ({
                id: statut.classe,
                title: `${statut.libelle}`+' <span class="badge">0</span>',
                class: 'kanban-column,entete-'+`${statut.classe}`,
                dragTo: STATUTS.map(s => s.classe),
                item: this.getTasksForStatus(statut.id)
            })),
            dropEl: async (el, target) => {
                if (isUpdating) return;
                isUpdating = true;

                const taskId = parseInt(el.dataset.eid);
                const newStatus = STATUTS.find(s => s.classe === target.parentElement.dataset.id)?.id;
                
                await grist.docApi.applyUserActions([
                    ['UpdateRecord', TABLE_ID, taskId, { statut: newStatus }]
                ]);

                isUpdating = false;
            }
        });
    }

     refreshKanban() {
        if (!this.kanban || isUpdating) return;
        isUpdating = true;

        STATUTS.forEach(statut => {
            const board = this.kanban.findBoard(statut.classe);
            board.querySelectorAll('.kanban-item').forEach(item => item.remove());
            tasks.forEach(task => {
                this.kanban.addElement(statut.classe, {
                    ...task,
                    dragHandle: '<div class="drag-handle">☰</div>' // Handle visible
                });
            });
            if (board) {
                board.querySelectorAll('.kanban-item').forEach(item => item.remove());
                const tasks = this.getTasksForStatus(statut.id);
                tasks.forEach(task => this.kanban.addElement(statut.classe, task));
                board.querySelector('.badge').textContent = tasks.length;
            }
        });

        isUpdating = false;
    }

    getTasksForStatus(status) {
        return this.currentRecords
            .filter(t => t.statut === status)
            .map(t => ({
                id: t.id.toString(),
                title: `
                    <div class="kanban-item-content">
                        <div class="fw-bold">${t.titre}</div>
                        ${t.description ? `<div class="text-muted">${t.description}</div>` : ''}
                        <div class="mt-2">
                            ${t.bureau.map(b => `<span class="badge bg-primary me-1">${b}</span>`).join('')}
                            ${t.qui.map(q => `<span class="badge bg-secondary me-1">${q}</span>`).join('')}
                            ${t.strategie_action ? `<div class="text-success mt-1">${t.strategie_action}</div>` : ''}
                        </div>
                    </div>
                `,
                class: `priority-${this.calculerPriorite(t.urgence, t.impact)}`
            }))
            .sort((a, b) => a.class.split('-')[1] - b.class.split('-')[1])
            .sort((a, b) => {
    const prioriteA = parseInt(a.class.split('-')[1]);
    const prioriteB = parseInt(b.class.split('-')[1]);
    return prioriteA - prioriteB; // Tri ascendant
});
    }

    calculerPriorite(urgence, impact) {
        const matrice = {
            "Critique,Immédiate": 1,
            "Critique,Courte": 1,
            "Critique,Moyenne": 2,
            "Critique,Longue": 2,
            "Important,Immédiate": 1,
            "Important,Courte": 2,
            "Important,Moyenne": 2,
            "Important,Longue": 3,
            "Modéré,Immédiate": 2,
            "Modéré,Courte": 3,
            "Modéré,Moyenne": 3,
            "Modéré,Longue": 4,
            "Mineur,Immédiate": 3,
            "Mineur,Courte": 3,
            "Mineur,Moyenne": 4,
            "Mineur,Longue": 4
        };
        return matrice[`${impact},${urgence}`] || 3;
    }

    async handleDrop(el, target) {
        if (isUpdating) return;
        isUpdating = true;

        const taskId = el.dataset.eid;
        const newStatusId = STATUTS.find(s => s.classe === target.parentElement.dataset.id)?.id;
        
        await grist.docApi.applyUserActions([
            ['UpdateRecord', TABLE_ID, parseInt(taskId), { statut: newStatusId }]
        ]);

        isUpdating = false;
    }

    initModal() {
        const modalElement = document.getElementById('popup-tache');
        if (!modalElement) return;

        this.modal = new bootstrap.Modal(modalElement, {
            backdrop: 'static',
            keyboard: false
        });
    }

    openPopup(tache) {
        this.currentTaskId = tache.id || null;
        
        document.getElementById('popup-titre').value = tache.titre || '';
        document.getElementById('popup-description').value = tache.description || '';
        document.getElementById('popup-statut').value = tache.statut || 'À faire';
        document.getElementById('popup-projet').value = tache.projet || '';

        this.remplirSelect('popup-bureau', BUREAUX, tache.bureau, true);
        this.remplirSelect('popup-qui', RESPONSABLES, tache.qui, true);
        this.remplirSelect('popup-strategie', this.strategies.map(s => s.action), tache.strategie_action);

        this.modal.show();
    }

    remplirSelect(id, options, valeurs, multiple = false) {
        const select = document.getElementById(id);
        if (!select) return;

        select.innerHTML = options.map(opt => 
            `<option value="${opt}" ${valeurs?.includes(opt) ? 'selected' : ''}>${opt}</option>`
        ).join('');

        if (multiple) select.multiple = true;
    }

    initEventListeners() {
        document.getElementById('btn-new-task').addEventListener('click', () => {
            this.openPopup({
                titre: 'Nouvelle tâche',
                statut: 'À faire',
                bureau: [],
                qui: [],
                urgence: 'Courte',
                impact: 'Modéré'
            });
        });

        document.getElementById('popup-sauvegarder').addEventListener('click', () => this.sauvegarderTache());
    }

    async sauvegarderTache() {
        const tache = {
            titre: document.getElementById('popup-titre').value,
            description: document.getElementById('popup-description').value,
            statut: document.getElementById('popup-statut').value,
            projet: document.getElementById('popup-projet').value,
            bureau: Array.from(document.getElementById('popup-bureau').selectedOptions).map(o => o.value),
            qui: Array.from(document.getElementById('popup-qui').selectedOptions).map(o => o.value),
            urgence: document.getElementById('popup-urgence').value,
            impact: document.getElementById('popup-impact').value,
            strategie_action: document.getElementById('popup-strategie').value
        };

        const actions = this.currentTaskId ?
            [['UpdateRecord', TABLE_ID, this.currentTaskId, tache]] :
            [['AddRecord', TABLE_ID, null, tache]];

        try {
            await grist.docApi.applyUserActions(actions);
            this.modal.hide();
            this.refreshKanban();
        } catch (error) {
            console.error("Erreur de sauvegarde:", error);
            alert(`Erreur: ${error.message}`);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new KanbanManager().init());
