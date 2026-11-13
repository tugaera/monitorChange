import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorText, send } from './api';
import { DEFAULT_CRITERIA, accessLabels, actionLabels, dateTime, hostName, money, relativeTime, safeExternalUrl, type AppSummary, type Criteria, type MonitorEvent, type Product, type Source, type SourceDetail } from './model';
import { Badge, Brand, Empty, ErrorNotice, Field, Icon, Loading, Modal } from './components';
import CriteriaEditor from './CriteriaEditor';
import SourceEditor from './SourceEditor';
import Offers from './Offers';
import ConfigTransfer from './ConfigTransfer';
import PasswordChange from './PasswordChange';

type Session = { authenticated: boolean; needsSetup: boolean };
type Page = 'dashboard' | 'products' | 'events' | 'settings';
type Sources = Record<string, Source[]>;

function Auth({ setup, onAuthenticated }: { setup: boolean; onAuthenticated: () => void }) {
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await send(setup ? '/setup' : '/session', 'POST', setup ? { token, password } : { password }); onAuthenticated(); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <div className="auth-layout"><aside className="auth-story"><Brand/><div className="auth-copy"><span className="eyebrow">A DISPONIBILIDADE MUDA. NÓS ACOMPANHAMOS.</span><h1>O produto certo.<br/>O momento certo.</h1><p>As lojas que lhe interessam, os critérios que escolheu e cada mudança num só lugar.</p><div className="auth-orbit" aria-hidden="true"><div className="orbit-ring"/><div className="orbit-ring inner"/><span className="orbit-core"><Icon name="activity" size={44}/></span><span className="orbit-node node-1"><Icon name="globe" size={25}/></span><span className="orbit-node node-2"><Icon name="box" size={25}/></span><span className="orbit-node node-3"><Icon name="bell" size={25}/></span></div></div><div className="auth-footer"><Icon name="shield" size={17}/> No seu servidor. Sob o seu controlo.</div></aside><main className="auth-main"><div className="auth-form"><div className="auth-mobile-brand"><Brand/></div><span className="eyebrow">MONITORCHANGE LOCAL</span><h2>{setup ? 'O seu observatório começa aqui.' : 'Bem-vindo de volta.'}</h2><p>{setup ? 'Defina a palavra-passe para aceder ao seu painel.' : 'Entre para acompanhar os produtos e consultar as últimas alterações.'}</p><form onSubmit={submit}>{error && <ErrorNotice message={error}/>} {setup && <Field label="Token de instalação" hint="O token definido na configuração inicial do servidor."><input type="password" value={token} required autoComplete="off" onChange={event => setToken(event.target.value)}/></Field>}<Field label="Palavra-passe" hint={setup ? 'Use pelo menos 12 caracteres.' : undefined}><input type="password" required minLength={setup ? 12 : undefined} maxLength={200} value={password} autoComplete={setup ? 'new-password' : 'current-password'} onChange={event => setPassword(event.target.value)}/></Field><button className="button primary full-width" disabled={busy}>{busy ? <><span className="spinner"/>A entrar…</> : <>{setup ? 'Configurar e entrar' : 'Entrar no painel'}<Icon name="arrow" size={18}/></>}</button></form><div className="auth-note"><Icon name="shield" size={17}/><span>Autenticação local. Sem conta cloud.</span></div></div></main></div>;
}

function ProductEditor({ product, onClose, onSaved }: { product?: Product; onClose: () => void; onSaved: (product: Product) => void }) {
  const [name, setName] = useState(product?.name || '');
  const [criteria, setCriteria] = useState<Criteria>(product?.criteria || structuredClone(DEFAULT_CRITERIA));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!criteria.actions.length) { setError('Escolha pelo menos uma modalidade.'); return; }
    setBusy(true);
    try {
      const fields = { name: name.trim(), ...(!product || JSON.stringify(criteria) !== JSON.stringify(product.criteria) ? { criteria } : {}) };
      onSaved(await send<Product>(product ? `/products/${product.id}` : '/products', product ? 'PATCH' : 'POST', fields));
    }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <Modal title={product ? 'Editar produto' : 'O que quer acompanhar?'} subtitle="Um produto pode ser acompanhado em várias lojas." onClose={onClose} wide><form onSubmit={submit}><div className="modal-body">{error && <ErrorNotice message={error}/>}<Field label="Nome do produto"><input required value={name} maxLength={160} placeholder="Dê um nome ao produto" onChange={event => setName(event.target.value)}/></Field><div className="form-intro"><h3>Os seus critérios de compra</h3><p>Aplicam-se a todas as fontes que herdem estes critérios.</p></div><CriteriaEditor value={criteria} onChange={setCriteria}/></div><div className="modal-footer"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? 'A guardar…' : product ? 'Guardar alterações' : 'Criar produto'}</button></div></form></Modal>;
}

function SourceStatus({ source }: { source: Source }) {
  if (!source.active) return <Badge>Em pausa</Badge>;
  if (source.lastStatus && source.lastStatus !== 'ok') return <Badge tone="amber">Requer atenção</Badge>;
  if (!source.lastSuccessAt) return <Badge tone="blue">À espera da primeira leitura</Badge>;
  const stale = Date.now() - Date.parse(source.lastSuccessAt) > Math.max(3 * source.intervalSeconds, 1800) * 1000;
  return stale ? <Badge tone="amber">Leitura desatualizada</Badge> : <Badge tone="green">A acompanhar</Badge>;
}

function SourcePanel({ source, onEdit, onAction }: { source: SourceDetail; onEdit: () => void; onAction: (source: Source, action: 'pause' | 'resume' | 'checks' | 'delete') => Promise<void> }) {
  const [tab, setTab] = useState<'offers' | 'history'>('offers');
  const [busy, setBusy] = useState(false);
  const checks = [...source.checks].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  const lastGood = checks.find(check => check.status === 'ok' && !check.obsolete && check.revision === source.revision);
  const stale = source.lastSuccessAt && Date.now() - Date.parse(source.lastSuccessAt) > Math.max(3 * source.intervalSeconds, 1800) * 1000;
  async function action(value: 'pause' | 'resume' | 'checks' | 'delete') { setBusy(true); try { await onAction(source, value); } finally { setBusy(false); } }
  return <section className="source-panel"><div className="source-panel-heading"><div className="source-heading-name"><span className="source-avatar"><Icon name="globe" size={23}/></span><div><h3>{source.name}</h3><a href={safeExternalUrl(source.url)} target="_blank" rel="noopener noreferrer">{hostName(source.url)}<Icon name="external" size={13}/></a></div></div><SourceStatus source={source}/></div>
    <div className="source-action-bar"><button className="button secondary small" disabled={busy} onClick={() => action('checks')}><Icon name="refresh" size={16}/>Verificar agora</button><button className="button secondary small" disabled={busy} onClick={() => action(source.active ? 'pause' : 'resume')}><Icon name={source.active ? 'pause' : 'play'} size={16}/>{source.active ? 'Pausar' : 'Ativar'}</button><button className="button ghost small" onClick={onEdit}><Icon name="edit" size={16}/>Editar</button><button className="icon-button danger-button" disabled={busy} title="Remover fonte" aria-label="Remover fonte" onClick={() => action('delete')}><Icon name="archive" size={17}/></button></div>
    <div className="source-meta-grid"><div><span>Última tentativa</span><strong title={source.lastAttemptAt || ''}>{dateTime(source.lastAttemptAt)}</strong></div><div><span>Última leitura válida</span><strong title={source.lastSuccessAt || ''}>{dateTime(source.lastSuccessAt)}</strong></div><div><span>Próxima verificação</span><strong>{source.active ? source.nextCheckAt ? dateTime(source.nextCheckAt) : 'A agendar' : 'Em pausa'}</strong></div><div><span>Contexto da fonte</span><strong>{source.region.country} · {source.region.locale} · {source.region.currency}</strong></div></div>
    {source.lastError && <div className="notice notice-error"><Icon name="info"/><span><strong>{source.lastStatus ? accessLabels[source.lastStatus] : 'Erro'}</strong> · {source.lastError}</span></div>}
    {stale && <div className="notice"><Icon name="clock"/><span>A última leitura válida está desatualizada. As ofertas abaixo são o último estado observado.</span></div>}
    {!source.active && !source.lastAttemptAt && <div className="notice"><Icon name="info"/><span>Confirme a configuração e ative esta fonte. A primeira leitura estabelece o estado inicial; os alertas acompanham as mudanças seguintes.</span></div>}
    <div className="tabs"><button className={tab === 'offers' ? 'active' : ''} onClick={() => setTab('offers')}>Ofertas observadas{lastGood && <span>{lastGood.offers.length}</span>}</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Histórico de leituras<span>{checks.length}</span></button></div>
    {tab === 'offers' ? lastGood ? <><div className="section-kicker">Leitura de {dateTime(lastGood.finishedAt)} · {lastGood.method === 'browser' ? 'Navegador' : 'HTTP'}</div>{lastGood.warnings.map((warning, index) => <div className="notice" key={index}><Icon name="info"/><span>{warning}</span></div>)}<Offers offers={lastGood.offers}/></> : <Empty icon="eye" title="Ainda sem ofertas observadas" description="Peça uma verificação ou ative a monitorização. Só as leituras válidas desta configuração aparecem aqui."/> : !checks.length ? <Empty icon="clock" title="O histórico começa na primeira leitura" description="As verificações desta fonte ficam registadas aqui, incluindo falhas e alterações de configuração."/> : <div className="history-list">{checks.map(check => <details className="history-item" key={check.id}><summary><span className={`history-dot ${check.status === 'ok' ? 'success' : 'warning'}`}/><span><strong>{accessLabels[check.status]}</strong><small>{dateTime(check.finishedAt)} · {check.method === 'browser' ? 'Navegador' : 'HTTP'} · revisão {check.revision}</small></span>{check.obsolete && <Badge>Configuração anterior</Badge>}<span className="muted">{check.offers.length} ofertas</span></summary><div className="history-content">{check.error && <ErrorNotice message={check.error}/>} {check.warnings.map((warning, index) => <p className="muted" key={index}>{warning}</p>)}<Offers offers={check.offers}/></div></details>)}</div>}
  </section>;
}

function EventsView({ events, onUpdate, compact = false }: { events: MonitorEvent[]; onUpdate: (id: string, patch: { read?: boolean; archived?: boolean }) => void; compact?: boolean }) {
  const [filter, setFilter] = useState<'all' | 'unread' | 'archived'>('all');
  const [pageIndex, setPageIndex] = useState(0);
  const [remoteEvents, setRemoteEvents] = useState<MonitorEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    if (compact) return;
    let cancelled = false; setLoadingEvents(true); setLoadError('');
    void api<MonitorEvent[]>(`/events?limit=50&offset=${pageIndex * 50}&archived=${filter === 'archived'}${filter === 'unread' ? '&unread=true' : ''}`)
      .then(value => { if (!cancelled) setRemoteEvents(value); })
      .catch(err => { if (!cancelled) setLoadError(errorText(err)); })
      .finally(() => { if (!cancelled) setLoadingEvents(false); });
    return () => { cancelled = true; };
  }, [compact, filter, pageIndex, events]);
  const filtered = compact ? events.filter(event => !event.archivedAt).slice(0, 5) : remoteEvents;
  return <>{!compact && <div className="segmented">{(['all', 'unread', 'archived'] as const).map(value => <button key={value} className={filter === value ? 'active' : ''} onClick={() => { setFilter(value); setPageIndex(0); }}>{value === 'all' ? 'Atuais' : value === 'unread' ? 'Não lidos' : 'Arquivados'}</button>)}</div>}{loadError && <ErrorNotice message={loadError}/>} {loadingEvents ? <Loading text="A carregar eventos…"/> : !filtered.length ? <Empty icon="bell" title={filter === 'archived' ? 'Nenhum evento arquivado' : 'Tudo tranquilo, por agora'} description="As alterações que cumpram os seus critérios e os diagnósticos das fontes aparecem aqui."/> : <div className="event-list">{filtered.map(event => <article key={event.id} className={`event-item ${event.readAt ? '' : 'unread'}`}><span className={`event-icon ${event.type === 'diagnostic' ? 'warning' : ''}`}><Icon name={event.type === 'diagnostic' ? 'info' : 'bell'} size={20}/></span><div className="event-content"><div className="event-title"><h3>{event.title}</h3><time dateTime={event.createdAt} title={dateTime(event.createdAt)}>{relativeTime(event.createdAt)}</time></div><p>{event.message}</p><span className="event-source">{event.productName} <span>·</span> {event.sourceName}</span><div className="event-actions"><a href={safeExternalUrl(event.url)} target="_blank" rel="noopener noreferrer">Abrir página<Icon name="external" size={13}/></a><button onClick={() => onUpdate(event.id, { read: !event.readAt })}>{event.readAt ? 'Marcar como não lido' : 'Marcar como lido'}</button><button onClick={() => onUpdate(event.id, { archived: !event.archivedAt })}>{event.archivedAt ? 'Desarquivar' : 'Arquivar'}</button></div></div></article>)}</div>}{!compact && <div className="pagination"><button className="button secondary small" disabled={loadingEvents || pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)}>Anterior</button><span>Página {pageIndex + 1}</span><button className="button secondary small" disabled={loadingEvents || filtered.length < 50} onClick={() => setPageIndex(pageIndex + 1)}>Seguinte</button></div>}</>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [page, setPage] = useState<Page>('dashboard');
  const [products, setProducts] = useState<Product[]>([]);
  const [sources, setSources] = useState<Sources>({});
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [summary, setSummary] = useState<AppSummary>({ products: 0, sources: 0, activeSources: 0, unreadEvents: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');
  const [productId, setProductId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [productEditor, setProductEditor] = useState<Product | 'new' | null>(null);
  const [sourceEditor, setSourceEditor] = useState<Source | 'new' | null>(null);
  const [archived, setArchived] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const currentDetail = useRef<string | null>(null);
  const product = products.find(item => item.id === productId);
  const activeProducts = products.filter(item => !item.archived);
  const listedProducts = products.filter(item => item.archived === archived && item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const allSources = Object.values(sources).flat();
  const attentionSources = allSources.filter(source => source.active && source.lastStatus && source.lastStatus !== 'ok');

  const loadSession = useCallback(async () => {
    setSessionError('');
    try { setSession(await api<Session>('/session')); } catch (err) { setSessionError(errorText(err)); }
  }, []);
  const load = useCallback(async () => {
    const [nextProducts, nextEvents, nextSummary] = await Promise.all([api<Product[]>('/products'), api<MonitorEvent[]>('/events?limit=200'), api<AppSummary>('/summary')]);
    const pairs = await Promise.all(nextProducts.filter(item => !item.archived).map(async item => [item.id, await api<Source[]>(`/products/${item.id}/sources`)] as const));
    setProducts(nextProducts); setEvents(nextEvents); setSummary(nextSummary); setSources(Object.fromEntries(pairs)); setError('');
  }, []);
  const refreshDetail = useCallback(async (id: string) => {
    const value = await api<SourceDetail>(`/sources/${id}`);
    if (currentDetail.current === id) setDetail(value);
  }, []);
  useEffect(() => { void loadSession(); const expired = () => { setSession({ authenticated: false, needsSetup: false }); setProducts([]); setSources({}); setEvents([]); setDetail(null); }; window.addEventListener('session-expired', expired); return () => window.removeEventListener('session-expired', expired); }, [loadSession]);
  useEffect(() => {
    if (!session?.authenticated) return;
    let cancelled = false; setLoading(true);
    void load().catch(err => !cancelled && setError(errorText(err))).finally(() => !cancelled && setLoading(false));
    const timer = window.setInterval(() => { void load().catch(err => setError(errorText(err))); if (currentDetail.current) void refreshDetail(currentDetail.current).catch(err => setError(errorText(err))); }, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [session?.authenticated, load, refreshDetail]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 6500); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    currentDetail.current = sourceId; setDetail(null);
    if (!sourceId) { setDetailLoading(false); return; }
    setDetailLoading(true); void refreshDetail(sourceId).catch(err => setError(errorText(err))).finally(() => { if (currentDetail.current === sourceId) setDetailLoading(false); });
  }, [sourceId, refreshDetail]);
  function navigate(next: Page) { setPage(next); setProductId(null); setSourceId(null); setQuery(''); setError(''); }
  function openProduct(value: Product) { setPage('products'); setProductId(value.id); setSourceId(sources[value.id]?.[0]?.id || null); }
  async function actSource(source: Source, action: 'pause' | 'resume' | 'checks' | 'delete') {
    if (action === 'delete') { setConfirm({ title: 'Remover esta fonte?', message: 'A monitorização será interrompida. Os eventos anteriores permanecem no histórico.', action: async () => { await send(`/sources/${source.id}`, 'DELETE'); setSourceId(null); await load(); setToast('Fonte removida.'); } }); return; }
    try { await send(`/sources/${source.id}/${action}`); await load(); await refreshDetail(source.id); setToast(action === 'checks' ? 'Verificação colocada na fila. A leitura respeita os limites da loja.' : action === 'resume' ? 'Monitorização ativada.' : 'Fonte em pausa.'); }
    catch (err) { setError(errorText(err)); }
  }
  async function updateEvent(id: string, patch: { read?: boolean; archived?: boolean }) {
    try { await send(`/events/${id}`, 'PATCH', patch); await load(); } catch (err) { setError(errorText(err)); }
  }
  async function archiveProduct(value: Product) {
    setConfirm({ title: value.archived ? 'Restaurar produto?' : 'Arquivar este produto?', message: value.archived ? 'As fontes ficam em pausa até as ativar novamente.' : 'Todas as fontes deste produto serão pausadas. O histórico é preservado.', action: async () => { await send(`/products/${value.id}`, 'PATCH', { archived: !value.archived }); setProductId(null); setSourceId(null); await load(); setToast(value.archived ? 'Produto restaurado.' : 'Produto arquivado.'); } });
  }
  if (!session) return <main className="startup"><Brand/>{sessionError ? <><ErrorNotice message={sessionError}/><button className="button primary" onClick={loadSession}>Tentar novamente</button></> : <Loading text="A ligar ao seu observatório…"/>}</main>;
  if (!session.authenticated) return <Auth setup={session.needsSetup} onAuthenticated={loadSession}/>;
  const headings = { dashboard: ['Visão geral', 'O seu observatório de disponibilidade.'], products: ['Os seus produtos', 'Vários produtos. Várias lojas. Os seus critérios.'], events: ['Caixa de eventos', 'As mudanças que merecem a sua atenção.'], settings: ['O seu servidor', 'Informação sobre esta instalação local.'] };
  return <div className="app-shell"><a className="skip-link" href="#main">Saltar para o conteúdo</a><aside className="sidebar"><Brand/><div className="workspace-label">ESPAÇO DE TRABALHO</div><nav aria-label="Navegação principal">{([{ id: 'dashboard', label: 'Visão geral', icon: 'grid' }, { id: 'products', label: 'Produtos', icon: 'box' }, { id: 'events', label: 'Eventos', icon: 'bell' }] as const).map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}><Icon name={item.icon}/><span>{item.label}</span>{item.id === 'events' && summary.unreadEvents > 0 && <span className="nav-count">{summary.unreadEvents}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="local-note"><span className="status-dot"/><div><strong>Instalação local</strong><small>Dados no seu servidor</small></div><Icon name="shield" size={18}/></div><button className={`sidebar-button ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Icon name="settings"/><span>O seu servidor</span></button><button className="sidebar-button" onClick={async () => { try { await send('/session', 'DELETE'); setSession({ authenticated: false, needsSetup: false }); setProductId(null); setSourceId(null); } catch (err) { setError(errorText(err)); } }}><Icon name="logout"/><span>Terminar sessão</span></button><span className="version-label">MonitorChange · 0.1</span></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Espaço pessoal<span>/</span><strong>{product ? product.name : headings[page][0]}</strong></div><div className="topbar-right"><span className="topbar-date">{new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'long' }).format(new Date())}</span><button className="icon-button notification-button" aria-label={`Eventos, ${summary.unreadEvents} não lidos`} onClick={() => navigate('events')}><Icon name="bell"/>{summary.unreadEvents > 0 && <span/>}</button><span className="user-avatar" title="Administrador local">L</span></div></header>
      <main id="main" className="main-content"><div className="page-heading"><div>{product && <button className="back-link" onClick={() => { setProductId(null); setSourceId(null); }}><Icon name="back" size={15}/>Todos os produtos</button>}<span className="eyebrow">{product ? 'DETALHE DO PRODUTO' : page === 'dashboard' ? 'ACOMPANHAMENTO CONTÍNUO' : 'MONITORCHANGE'}</span><h1>{product ? product.name : headings[page][0]}</h1><p>{product ? 'Compare as fontes e acompanhe cada oferta no seu contexto.' : headings[page][1]}</p></div><div className="heading-actions">{product ? <><button className="button secondary" onClick={() => setProductEditor(product)}><Icon name="edit" size={16}/>Editar produto</button>{!product.archived && <button className="button primary" onClick={() => setSourceEditor('new')}><Icon name="plus" size={18}/>Adicionar fonte</button>}</> : (page === 'dashboard' || page === 'products') && <button className="button primary" onClick={() => setProductEditor('new')}><Icon name="plus" size={18}/>Adicionar produto</button>}</div></div>
        {error && <div className="page-error"><ErrorNotice message={error}/><button className="button ghost small" onClick={() => { void load().catch(err => setError(errorText(err))); }}>Atualizar</button></div>}
        {loading ? <Loading text="A carregar os seus produtos…"/> : <>
          {page === 'dashboard' && <><div className="stat-grid">{[{ label: 'Produtos acompanhados', value: activeProducts.length, icon: 'box', note: 'Organizados à sua medida' }, { label: 'Fontes ativas', value: summary.activeSources, icon: 'activity', note: `${summary.sources} fontes configuradas` }, { label: 'Eventos não lidos', value: summary.unreadEvents, icon: 'bell', note: 'Mudanças e diagnósticos' }, { label: 'Fontes a rever', value: attentionSources.length, icon: 'eye', note: 'Acesso ou leitura com falha' }].map((stat, index) => <div className={`stat-card stat-${index}`} key={stat.label}><div className="stat-label">{stat.label}<Icon name={stat.icon} size={19}/></div><strong>{stat.value.toString().padStart(2, '0')}</strong><small>{stat.note}</small></div>)}</div>
          {!activeProducts.length ? <section className="welcome-card"><div className="welcome-copy"><span className="eyebrow">PRONTO PARA COMEÇAR</span><h2>Uma lista de desejos.<br/>Um olho em cada loja.</h2><p>Adicione o primeiro produto e depois as páginas das lojas. O MonitorChange acompanha as alterações de acordo com os seus critérios.</p><button className="button primary" onClick={() => setProductEditor('new')}>Adicionar o primeiro produto<Icon name="arrow" size={18}/></button><span className="welcome-footnote"><Icon name="shield" size={15}/> Sem compras automáticas. A decisão é sua.</span></div><div className="welcome-visual" aria-hidden="true"><div className="visual-grid"/><div className="visual-card card-back"><Icon name="globe" size={26}/><div/><div/></div><div className="visual-card card-front"><span className="visual-icon"><Icon name="box" size={34}/></span><span className="visual-line"/><span className="visual-line short"/><span className="visual-pill"><span/>A acompanhar</span></div><div className="visual-bell"><Icon name="bell" size={25}/></div><div className="visual-cross one">+</div><div className="visual-cross two">+</div></div></section> : <section className="panel"><div className="panel-heading"><div><h2>Os seus produtos</h2><p>Disponibilidade acompanhada em várias fontes.</p></div><button className="text-button" onClick={() => navigate('products')}>Ver todos<Icon name="arrow" size={16}/></button></div><ProductList products={activeProducts.slice(0, 5)} sources={sources} onSelect={openProduct}/></section>}
          <div className="dashboard-bottom"><section className="panel"><div className="panel-heading"><div><h2>Últimos eventos</h2><p>O que mudou desde a última visita.</p></div><button className="text-button" onClick={() => navigate('events')}>Ver caixa<Icon name="arrow" size={16}/></button></div><EventsView events={events} compact onUpdate={updateEvent}/></section><aside className="how-card"><span className="how-icon"><Icon name="shield" size={26}/></span><span className="eyebrow">CADA SINAL, NO SEU CONTEXTO</span><h2>Mais do que<br/>“há stock”.</h2><p>Vendedor, variante, preço e modalidade são avaliados em conjunto.</p><div className="how-feature"><Icon name="check" size={16}/>Marketplace excluído por omissão</div><div className="how-feature"><Icon name="check" size={16}/>Histórico e evidência por oferta</div><div className="how-feature"><Icon name="check" size={16}/>Monitorização no servidor</div></aside></div></>}
          {page === 'products' && !product && <section className="panel"><div className="list-toolbar"><label className="search-field"><Icon name="search" size={18}/><input aria-label="Pesquisar produtos" value={query} placeholder="Pesquisar produtos…" onChange={event => setQuery(event.target.value)}/></label><div className="segmented"><button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>Ativos</button><button className={archived ? 'active' : ''} onClick={() => setArchived(true)}>Arquivados</button></div></div>{listedProducts.length ? <ProductList products={listedProducts} sources={sources} onSelect={openProduct}/> : <Empty title={query ? 'Nenhum produto encontrado' : archived ? 'Sem produtos arquivados' : 'A sua lista começa aqui'} description={query ? 'Experimente outro nome de produto.' : 'Crie um produto e adicione as páginas que quer acompanhar.'}>{!query && !archived && <button className="button primary" onClick={() => setProductEditor('new')}><Icon name="plus" size={17}/>Adicionar produto</button>}</Empty>}</section>}
          {page === 'products' && product && <>{product.archived ? <section className="panel"><Empty icon="archive" title="Este produto está arquivado" description="As fontes estão pausadas e o histórico foi preservado."><button className="button primary" onClick={() => archiveProduct(product)}>Restaurar produto</button></Empty></section> : <div className="product-layout"><aside className="source-column"><div className="sources-heading"><h2>Fontes <span>{sources[product.id]?.length || 0}</span></h2><button className="icon-button" aria-label="Adicionar fonte" onClick={() => setSourceEditor('new')}><Icon name="plus" size={18}/></button></div><div className="source-list">{sources[product.id]?.map(source => <button className={`source-choice ${sourceId === source.id ? 'selected' : ''}`} key={source.id} onClick={() => setSourceId(source.id)}><span className="source-choice-top"><span className="mini-source-icon"><Icon name="globe" size={18}/></span><strong>{source.name}</strong><Icon name="arrow" size={15}/></span><span className="source-choice-domain">{hostName(source.url)}</span><SourceStatus source={source}/><span className="source-choice-time"><Icon name="clock" size={13}/>{relativeTime(source.lastAttemptAt)}</span></button>)}</div><div className="criteria-card"><span className="eyebrow">CRITÉRIOS DO PRODUTO</span><p><Icon name="shield" size={15}/>{product.criteria.sellerPolicy === 'direct_only' ? 'Apenas retalhista direto' : 'Marketplace incluído'}</p><p><Icon name="box" size={15}/>{product.criteria.condition === 'new' ? 'Apenas novo' : 'Qualquer condição'}</p><p><Icon name="globe" size={15}/>{product.criteria.currency}{product.criteria.maxPriceMinor !== null ? ` · até ${money(product.criteria.maxPriceMinor, product.criteria.currency)}` : ' · sem limite de preço'}</p><button className="text-button" onClick={() => setProductEditor(product)}>Ajustar critérios<Icon name="arrow" size={14}/></button></div><button className="text-button muted archive-product" onClick={() => archiveProduct(product)}><Icon name="archive" size={15}/>Arquivar produto</button></aside><div className="source-content">{detailLoading ? <section className="panel"><Loading/></section> : detail && detail.id === sourceId ? <SourcePanel key={detail.id} source={detail} onEdit={() => setSourceEditor(detail)} onAction={actSource}/> : <section className="panel"><Empty icon="globe" title={sources[product.id]?.length ? 'Escolha uma fonte' : 'Em que lojas quer acompanhar?'} description="Adicione uma página de produto. Pode configurar critérios diferentes para cada loja."><button className="button primary" onClick={() => setSourceEditor('new')}><Icon name="plus" size={17}/>Adicionar fonte</button></Empty></section>}</div></div>}</>}
          {page === 'events' && <section className="panel events-panel"><div className="panel-heading"><div><h2>Alterações e diagnósticos</h2><p>{summary.unreadEvents} eventos por ler · leitura e arquivo não alteram a monitorização.</p></div><Badge tone="green">Alertas locais</Badge></div><EventsView events={events} onUpdate={updateEvent}/></section>}
          {page === 'settings' && <section className="panel settings-panel"><div className="panel-heading"><div><h2>MonitorChange no seu ambiente</h2><p>Interface local, dados persistentes e verificações no servidor.</p></div><Icon name="shield" size={28}/></div><div className="settings-grid"><div><span className="eyebrow">MONITORIZAÇÃO</span><h3>Continua com o navegador fechado</h3><p>As fontes ativas são verificadas pelo servidor. Consulte a última tentativa e a próxima leitura no detalhe de cada fonte.</p></div><div><span className="eyebrow">NOTIFICAÇÕES</span><h3>Uma caixa de eventos local</h3><p>As alterações ficam guardadas nesta interface. Email, Discord e Telegram pertencem a uma fase posterior.</p></div><div><span className="eyebrow">CONTEXTO REGIONAL</span><h3>Configurável por fonte</h3><p>País, idioma, moeda e código postal são definidos ao adicionar ou editar uma fonte. A aplicação mostra informação insuficiente quando não consegue confirmar os critérios.</p></div><div><span className="eyebrow">O QUE É OBSERVADO</span><h3>Sinais de disponibilidade</h3><p>A aplicação observa ofertas e botões. Não adiciona artigos ao carrinho nem confirma a conclusão de uma compra.</p></div></div><div className="notice"><Icon name="clock"/><span>As consultas são periódicas. Uma reposição mais curta do que o intervalo pode não ser detetada.</span></div><ConfigTransfer onImported={() => { void load().catch(err => setError(errorText(err))); }}/><PasswordChange/></section>}
        </>}
        <footer className="main-footer"><span>MonitorChange <span className="footer-dot">·</span> O seu observatório de stock</span><span><Icon name="shield" size={13}/> Dados locais, decisões suas.</span></footer>
      </main>
    </div>{toast && <div className="toast" role="status"><span><Icon name="check" size={19}/></span>{toast}<button className="icon-button" aria-label="Fechar aviso" onClick={() => setToast('')}><Icon name="close" size={16}/></button></div>}
    {productEditor && <ProductEditor product={productEditor === 'new' ? undefined : productEditor} onClose={() => setProductEditor(null)} onSaved={value => { setProductEditor(null); setToast(productEditor === 'new' ? 'Produto criado. Adicione agora a primeira fonte.' : 'Produto atualizado.'); setProducts(items => [...items.filter(item => item.id !== value.id), value]); if (productEditor === 'new') setSourceId(null); setPage('products'); setProductId(value.id); void load().catch(err => setError(errorText(err))); }}/>} 
    {sourceEditor && product && <SourceEditor product={product} source={sourceEditor === 'new' ? undefined : sourceEditor} onClose={() => setSourceEditor(null)} onSaved={value => { setSourceEditor(null); setSourceId(value.id); setDetail(value); setToast(sourceEditor === 'new' ? 'Fonte guardada em pausa. Ative-a quando estiver pronta.' : 'Fonte atualizada.'); void load().catch(err => setError(errorText(err))); }}/>} 
    {confirm && <Modal title={confirm.title} onClose={() => !confirmBusy && setConfirm(null)}><div className="modal-body"><p>{confirm.message}</p></div><div className="modal-footer"><button className="button ghost" disabled={confirmBusy} onClick={() => setConfirm(null)}>Cancelar</button><button className="button primary" disabled={confirmBusy} onClick={async () => { setConfirmBusy(true); try { await confirm.action(); setConfirm(null); } catch (err) { setError(errorText(err)); setConfirm(null); } finally { setConfirmBusy(false); } }}>{confirmBusy ? 'A guardar…' : 'Confirmar'}</button></div></Modal>}
  </div>;
}

function ProductList({ products, sources, onSelect }: { products: Product[]; sources: Sources; onSelect: (product: Product) => void }) {
  return <div className="product-list"><div className="product-table-head"><span>PRODUTO</span><span>FONTES</span><span>ACOMPANHAMENTO</span><span/></div>{products.map(product => { const items = sources[product.id] || []; const active = items.filter(source => source.active).length; return <button className="product-row" key={product.id} onClick={() => onSelect(product)}><span className="product-cell"><span className="product-avatar"><Icon name="box" size={23}/></span><span><strong>{product.name}</strong><small>{product.criteria.variant || 'Todas as variantes configuradas'}</small></span></span><span className="sources-cell">{items.length ? <><span className="source-circles">{items.slice(0, 3).map(source => <span key={source.id} title={source.name}>{source.name.charAt(0).toUpperCase()}</span>)}</span><span>{items.length} {items.length === 1 ? 'fonte' : 'fontes'}</span></> : <span className="muted">Adicionar fontes</span>}</span><span>{product.archived ? <Badge>Arquivado</Badge> : active ? <Badge tone="green">{active} {active === 1 ? 'fonte ativa' : 'fontes ativas'}</Badge> : <Badge>{items.length ? 'Em pausa' : 'Por configurar'}</Badge>}</span><Icon name="arrow" size={18}/></button>; })}</div>;
}
