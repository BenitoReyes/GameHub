export function showAlert(message) {
    try { alert(message); } catch (e) { console.log('Alert:', message); }
}

export function createModal({ title = '', body = '', actions = [] } = {}) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    const content = document.createElement('div');
    content.className = 'modal-content';
    if (title) content.appendChild(Object.assign(document.createElement('h3'), { textContent: title }));
    if (body) content.appendChild(Object.assign(document.createElement('p'), { textContent: body }));
    actions.forEach(a => content.appendChild(a));
    modal.appendChild(content);
    document.body.appendChild(modal);
    return { modal, content };
}
