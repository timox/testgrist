const STATUTS = [
  { id: 'Backlog', libelle: 'Backlog', classe: 'backlog' },
  { id: 'À faire', libelle: 'À faire', classe: 'a-faire' },
  { id: 'En cours', libelle: 'En cours', classe: 'en-cours' },
  { id: 'En attente', libelle: 'En attente', classe: 'en-attente' },
  { id: 'Bloqué', libelle: 'Bloqué', classe: 'bloque' },
  { id: 'Validation', libelle: 'Validation', classe: 'validation' },
  { id: 'Terminé', libelle: 'Terminé', classe: 'termine' }
];
const DEFAULT_BUREAUX = ['Exploit', 'Réseau', 'BDD', 'Chef SSIR'];
const DEFAULT_RESPONSABLES = ['Alex', 'Timothée', 'Isabelle', 'Chloé', 'Paul', 'Théo', 'Gaël', 'Thomas', 'Elie', 'Landry', 'Presta'];
const DEFAULT_URGENCES = ['Immédiate', 'Courte', 'Moyenne', 'Longue'];
const DEFAULT_IMPACTS = ['Critique', 'Important', 'Modéré', 'Mineur'];
const DEFAULT_STATUTS = STATUTS.map(s => s.id);
const DEFAULT_PROJETS = [
  'accès distants', 'AD', 'SSI', 'caméras pièton', 'astre finances', 'correspondants', 'autre projet',
  'conformité systèmes', 'MCO', 'conformité RZO', 'firewall', 'Libriciel', 'intranet-extranet',
  'optimops', 'attestation assurances', 'horoquartz', 'administratif-budget'
];
const TABLE_ID = "Ssir_principale_task";
const REQUIRED_COLUMNS = [
  'id', 'titre', 'description', 'statut', 'bureau', 'qui', 'urgence', 'impact', 'projet',
  'strategie_id', 'strategie_action', 'strategie_objectif', 'notes', 'delai'
];
let projetsDynamiques = [];

function displayError(message) {
  console.error("ERREUR:", message);
  const el = document.getElementById('error-container');
  if (el) {
    const p = document.createElement('div');
    p.className = 'alert alert-danger m-3';
    p.textContent = `Erreur Kanban: ${message}`;
    el.innerHTML = '';
    el.appendChild(p);
  }
  const k = document.getElementById('kanban-container');
  if (k && k.innerHTML.includes('Chargement')) k.innerHTML = '';
}

class KanbanManager {
  constructor() {
    this.kanbanContainer = document.getElementById('kanban-container');
    this.currentRecords = [];
    this.modalElement = document.getElementById('popup-tache');
    this.modal = null;
    this.currentTaskId = null;
    this.isUpdating = false;
    this.gristOptions = {};
    this.ignoreNextOnRecords = false;
    this.filters = { bureau: '', qui: '', projet: '', statut: '' };
    this.showTermine = true;
    this.sortableInstances = [];
    this.flatpickr = null;
    this.init();
  }

  async init() {
    await this.waitForGristReady();
    await this.loadGristDataAndOptions();
    this.initFilters();
    this.initModalWithOptions();
    this.initFlatpickr();
    this.refreshKanban();
    this.initEventListeners();
  }

  async waitForGristReady() {
    return new Promise((resolve) => {
      grist.ready({ requiredAccess: 'full' });
      grist.onRecords(this.handleGristUpdate.bind(this));
      setTimeout(resolve, 50);
    });
  }

  async loadGristDataAndOptions() {
    try {
      const records = await grist.docApi.fetchTable(TABLE_ID);
      this.currentRecords = this.mapGristRecords(records);
      this.gristOptions.statut = DEFAULT_STATUTS;
      this.gristOptions.urgence = DEFAULT_URGENCES;
      this.gristOptions.impact = DEFAULT_IMPACTS;
      this.gristOptions.bureau = [...DEFAULT_BUREAUX];
      this.gristOptions.qui = [...DEFAULT_RESPONSABLES];
      this.gristOptions.projet = [...DEFAULT_PROJETS];
    } catch (error) {
      this.gristOptions.statut = DEFAULT_STATUTS;
      this.gristOptions.urgence = DEFAULT_URGENCES;
      this.gristOptions.impact = DEFAULT_IMPACTS;
      this.gristOptions.bureau = DEFAULT_BUREAUX;
      this.gristOptions.qui = DEFAULT_RESPONSABLES;
      this.gristOptions.projet = DEFAULT_PROJETS;
      if (!this.currentRecords) this.currentRecords = [];
    }
  }

  mapGristRecords(gristData) {
    const records = [];
    if (!gristData || typeof gristData !== 'object') return [];
    const keys = Object.keys(gristData);
    if (!keys.includes('id') || !Array.isArray(gristData.id)) return [];
    const num = gristData.id.length;
    const cols = REQUIRED_COLUMNS;
    for (let i = 0; i < num; i++) {
      const rec = {};
      let ok = true;
      for (const key of cols) {
        if (gristData.hasOwnProperty(key) && Array.isArray(gristData[key]) && gristData[key].length > i) {
          const v = gristData[key][i];
          if ((key === 'bureau' || key === 'qui') && Array.isArray(v) && v[0] === 'L') {
            rec[key] = v;
          } else if ((key === 'bureau' || key === 'qui') && (!Array.isArray(v) || v[0] !== 'L')) {
            rec[key] = ['L'];
          } else {
            rec[key] = v;
          }
        } else if (key === 'id') { ok = false; break; }
        else rec[key] = null;
      }
      if (ok) { rec.id = parseInt(rec.id, 10); if (!isNaN(rec.id)) records.push(rec); }
    }
    return records;
  }

  handleGristUpdate(gristRecords, mappings = null) {
    if (this.isUpdating) return;
    if (this.ignoreNextOnRecords) { this.ignoreNextOnRecords = false; return; }
    this.isUpdating = true;
    grist.docApi.fetchTable(TABLE_ID).then(fresh => {
      this.currentRecords = this.mapGristRecords(fresh);
      this.initFilters();
      this.refreshKanban();
    }).finally(() => { this.isUpdating = false; });
  }

  signalLocalUpdate() {
    this.ignoreNextOnRecords = true;
    setTimeout(() => { this.ignoreNextOnRecords = false; }, 500);
  }

  initFilters() {
    this.populateSelectWithOptions('filter-bureau', this.gristOptions.bureau || []);
    this.populateSelectWithOptions('filter-qui', this.gristOptions.qui || []);
    this.populateSelectWithOptions('filter-projet', this.gristOptions.projet || []);
    this.populateSelectWithOptions('filter-statut', DEFAULT_STATUTS);

    // Listeners filtres
    ['filter-bureau', 'filter-qui', 'filter-projet', 'filter-statut'].forEach(id => {
      const sel = document.getElementById(id);
      if (sel) sel.onchange = () => {
        this.filters.bureau = document.getElementById('filter-bureau').value;
        this.filters.qui = document.getElementById('filter-qui').value;
        this.filters.projet = document.getElementById('filter-projet').value;
        this.filters.statut = document.getElementById('filter-statut').value;
        this.refreshKanban();
      };
    });
    const cb = document.getElementById('show-termine');
    if (cb) cb.onchange = () => { this.showTermine = cb.checked; this.refreshKanban(); };
  }

  filterRecords(records) {
    return records.filter(r => {
      if (this.filters.bureau && (!Array.isArray(r.bureau) || !r.bureau.includes(this.filters.bureau))) return false;
      if (this.filters.qui && (!Array.isArray(r.qui) || !r.qui.includes(this.filters.qui))) return false;
      if (this.filters.projet && r.projet !== this.filters.projet) return false;
      if (this.filters.statut && r.statut !== this.filters.statut) return false;
      return true;
    });
  }

  initModalWithOptions() {
    this.modalElement = document.getElementById('popup-tache');
    if (this.modalElement) {
      this.modal = new bootstrap.Modal(this.modalElement, { backdrop: 'static', keyboard: false });
      this.populateSelectWithOptions('popup-urgence', this.gristOptions.urgence || [], true);
      this.populateSelectWithOptions('popup-impact', this.gristOptions.impact || [], true);
      this.populateSelectWithOptions('popup-bureau', this.gristOptions.bureau || [], false);
      this.populateSelectWithOptions('popup-qui', this.gristOptions.qui || [], false);
      this.populateSelectWithOptions('popup-projet', this.gristOptions.projet || [], true);
      document.getElementById('btn-ajout-projet').onclick = () => {
        const champ = document.getElementById('projet-ajout');
        const val = champ.value.trim();
        if(val && !this.gristOptions.projet.includes(val)) {
          this.gristOptions.projet.push(val);
          this.populateSelectWithOptions('popup-projet', this.gristOptions.projet, true);
          champ.value = '';
        }
      };
    }
  }

  populateSelectWithOptions(selectId, options, addEmptyOption = true) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '';
    if (!Array.isArray(options)) return;
    if (addEmptyOption && !sel.multiple) {
      const opt = document.createElement('option');
      opt.value = "";
      opt.text = selectId.startsWith('filter-') ? "Tous" : "-- Choisir --";
      sel.appendChild(opt);
    }
    options.forEach(v => {
      if (v !== null && typeof v !== 'undefined') {
        const o = document.createElement('option');
        o.value = v;
        o.text = v;
        sel.appendChild(o);
      }
    });
  }

  initFlatpickr() {
    this.flatpickr = flatpickr('#popup-delai', {
      altInput: true,
      altFormat: "j F Y",
      dateFormat: "Y-m-d",
      locale: 'fr',
      disableMobile: true
    });
    document.getElementById('delai-type').addEventListener('change', (e) => {
      if (e.target.value === 'date') {
        this.flatpickr.set('clickOpens', true);
        document.getElementById('popup-delai').placeholder = "Sélectionner une date";
      } else {
        this.flatpickr.set('clickOpens', false);
        document.getElementById('popup-delai').placeholder = `Nombre de ${e.target.value}`;
      }
    });
  }

  openPopup(tache = {}) {
    if (!this.modal || !this.modalElement) return;
    const isNewTask = !tache.id;
    this.currentTaskId = tache.id || null;
    const trySet = (id, value) => { const el = document.getElementById(id); if (el) el.value = value || ""; };
    trySet('popup-id', tache.id || '');
    trySet('popup-titre', tache.titre || '');
    trySet('popup-description', tache.description || '');
    trySet('popup-statut-text', tache.statut || (isNewTask ? (STATUTS[0]?.id || '') : ''));
    trySet('popup-projet', tache.projet || '');
    trySet('popup-urgence', tache.urgence || '');
    trySet('popup-impact', tache.impact || '');
    this.setSelectedOptions('popup-bureau', tache.bureau);
    this.setSelectedOptions('popup-qui', tache.qui);
    const delaiInput = document.getElementById('popup-delai');
    if (delaiInput && tache.delai) delaiInput.value = tache.delai;
    this.modal.show();
  }

  setSelectedOptions(selectId, valuesWithL) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const values = Array.isArray(valuesWithL) && valuesWithL[0] === 'L' ? valuesWithL.slice(1) : [];
    const lowerVals = values.map(v => String(v).trim().toLowerCase());
    Array.from(sel.options).forEach(o => {
      const vClean = String(o.value).trim().toLowerCase();
      o.selected = lowerVals.includes(vClean);
    });
  }

  refreshKanban() {
    if (!this.kanbanContainer) return;
    this.sortableInstances.forEach(s => s.destroy());
    this.sortableInstances = [];
    const filteredRecords = this.filterRecords(this.currentRecords || []);
    const statutsToShow = this.showTermine ? STATUTS : STATUTS.filter(s => s.id !== 'Terminé');
    let kanbanHTML = '';
    statutsToShow.forEach(statut => {
      const boardId = statut.classe;
      const boardRecords = filteredRecords.filter(r => r.statut === statut.id);
      boardRecords.sort((a, b) => a.id - b.id);
      const itemsHTML = boardRecords.map(record => this.createTaskElementHTML(record)).join('');
      const count = boardRecords.length;
      const isHidden = (count === 0 && statut.id !== 'Terminé' && this.showTermine);
      const hiddenClass = isHidden ? ' board-hidden' : '';
      kanbanHTML += `
        <div id="board-${boardId}" class="kanban-board board-${boardId}${hiddenClass}">
          <div class="kanban-board-header">
            <span class="board-title">${statut.libelle}</span>
            <span class="board-count">${count}</span>
          </div>
          <div class="kanban-board-body" id="items-${boardId}" data-status="${statut.id}">
            ${itemsHTML}
          </div>
        </div>
      `;
    });
    this.kanbanContainer.innerHTML = kanbanHTML;
    statutsToShow.forEach(statut => {
      const boardId = statut.classe;
      const el = document.getElementById(`items-${boardId}`);
      if (el) {
        const sortable = new Sortable(el, {
          group: 'kanban',
          animation: 150,
          handle: '.drag-handle',
          onEnd: evt => this.handleDragEnd(evt, statut.id)
        });
        this.sortableInstances.push(sortable);
      }
    });
    // Edition uniquement sur le titre
    Array.from(this.kanbanContainer.querySelectorAll('.kanban-item .editable-zone')).forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = el.closest('.kanban-item');
        const id = parseInt(item.dataset.id, 10);
        const tache = this.currentRecords.find(r => r.id === id);
        if (tache) this.openPopup(tache);
      });
    });
  }

  handleDragEnd(evt, statut) {
    if (!evt.item) return;
    const id = parseInt(evt.item.dataset.id, 10);
    const record = this.currentRecords.find(r => r.id === id);
    if (!record) return;
    const newStatus = evt.to.dataset.status;
    if (record.statut !== newStatus) {
      if (!grist.docApi.updateRecords) {
        displayError("grist.docApi.updateRecords n'est pas disponible dans ce contexte.");
        return;
      }
      grist.docApi.updateRecords(TABLE_ID, [id], { statut: newStatus }).then(() => {
        this.signalLocalUpdate();
      });
    }
  }

  createTaskElementHTML(record) {
    let delaiHTML = '';
    if (record.delai) {
      const status = this.getDelaiStatus(record.delai);
      delaiHTML = `<div class="delai-indicator ${status}">
        <i class="bi bi-calendar-event me-1"></i>${this.formatDelai(record.delai)}
      </div>`;
    }
    let urgenceBadge = '';
    if (record.urgence) {
      const u = record.urgence.toLowerCase();
      let cls = '';
      if (u === 'immédiate' || u === 'immediate') cls = 'priority-badge priority-immediate';
      else if (u === 'courte') cls = 'priority-badge priority-courte';
      else if (u === 'moyenne') cls = 'priority-badge priority-moyenne';
      else if (u === 'longue') cls = 'priority-badge priority-longue';
      urgenceBadge = `<span class="${cls}">${record.urgence}</span>`;
    }
    let impactBadge = '';
    if (record.impact) {
      const i = record.impact.toLowerCase();
      let cls = '';
      if (i === 'critique') cls = 'impact-badge impact-critique';
      else if (i === 'important') cls = 'impact-badge impact-important';
      else if (i === 'modéré') cls = 'impact-badge impact-modéré';
      else if (i === 'mineur') cls = 'impact-badge impact-mineur';
      impactBadge = `<span class="${cls}">${record.impact}</span>`;
    }
    let projetTag = '';
    if (record.projet) {
      projetTag = `<span class="badge bg-info text-dark">${record.projet}</span>`;
    }
    let bureaux = '';
    if (Array.isArray(record.bureau) && record.bureau.length > 1) {
      bureaux = record.bureau.slice(1).map(b => `<span class="badge bg-secondary">${b}</span>`).join(' ');
    }
    let qui = '';
    if (Array.isArray(record.qui) && record.qui.length > 1) {
      qui = record.qui.slice(1).map(q => `<span class="assignee-avatar">${q[0]}</span>`).join(' ');
    }
    let desc = '';
    if (record.description) {
      desc = `<div class="item-description">${record.description}</div>`;
    }
    // Ajout poignée de drag + zone éditable
    return `<div class="kanban-item" data-id="${record.id}">
      <div class="drag-handle" title="Déplacer"><i class="bi bi-arrows-move"></i></div>
      <div class="item-title editable-zone">${record.titre || ''}</div>
      ${desc}
      <div class="item-meta">
        <div class="item-badges">
          ${urgenceBadge} ${impactBadge} ${projetTag} ${bureaux}
        </div>
        <div class="item-assignees">${qui}</div>
      </div>
      ${delaiHTML}
    </div>`;
  }

  getDelaiStatus(delaiDate) {
    const today = new Date();
    const d = new Date(delaiDate);
    const diff = (d - today) / (1000 * 3600 * 24);
    if (diff < 0) return 'delai-depasse';
    if (diff <= 7) return 'delai-urgent';
    return 'delai-ok';
  }
  formatDelai(dateStr) {
    const options = { weekday: 'short', day: 'numeric', month: 'short' };
    return new Date(dateStr).toLocaleDateString('fr-FR', options);
  }

  async saveTask() {
    const delaiType = document.getElementById('delai-type').value;
    let delaiValue = '';
    if (delaiType === 'date') {
      delaiValue = this.flatpickr.selectedDates[0] ? this.flatpickr.formatDate(this.flatpickr.selectedDates[0], "Y-m-d") : '';
    } else {
      const qte = parseInt(document.getElementById('popup-delai').value);
      if (!isNaN(qte) && qte > 0) {
        const today = new Date();
        if (delaiType === 'semaines') today.setDate(today.getDate() + qte * 7);
        else today.setMonth(today.getMonth() + qte);
        delaiValue = today.toISOString().slice(0,10);
      }
    }
    const titre = document.getElementById('popup-titre').value;
    const description = document.getElementById('popup-description').value;
    const statut = document.getElementById('popup-statut-text').value;
    const projet = document.getElementById('popup-projet').value;
    const urgence = document.getElementById('popup-urgence').value;
    const impact = document.getElementById('popup-impact').value;
    const bureau = Array.from(document.getElementById('popup-bureau').selectedOptions).map(o => o.value);
    const qui = Array.from(document.getElementById('popup-qui').selectedOptions).map(o => o.value);
    const row = {
      titre, description, statut, projet, urgence, impact,
      bureau: ['L', ...bureau],
      qui: ['L', ...qui],
      delai: delaiValue
    };
    if (!grist.docApi.updateRecords || !grist.docApi.addRecords) {
      displayError("grist.docApi.updateRecords/addRecords n'est pas disponible dans ce contexte.");
      return;
    }
    if (this.currentTaskId) {
      await grist.docApi.updateRecords(TABLE_ID, [this.currentTaskId], row);
    } else {
      await grist.docApi.addRecords(TABLE_ID, [row]);
    }
    this.signalLocalUpdate();
    this.modal.hide();
    this.refreshKanban();
  }

  calculerPriorite(urgence, impact) {
    let score = 50;
    if (!urgence && !impact) return score;
    if (urgence) {
      if (urgence.toLowerCase().startsWith('imm')) score -= 20;
      else if (urgence.toLowerCase().startsWith('cour')) score -= 10;
      else if (urgence.toLowerCase().startsWith('moy')) score += 0;
      else if (urgence.toLowerCase().startsWith('long')) score += 10;
    }
    if (impact) {
      if (impact.toLowerCase().startsWith('crit')) score -= 15;
      else if (impact.toLowerCase().startsWith('imp')) score -= 5;
      else if (impact.toLowerCase().startsWith('mod')) score += 0;
      else if (impact.toLowerCase().startsWith('min')) score += 8;
    }
    return score;
  }

  initEventListeners() {
    document.getElementById('btn-save-task').onclick = () => this.saveTask();
    document.getElementById('btn-nouvelle-tache').onclick = () => this.openPopup();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new KanbanManager();
});
