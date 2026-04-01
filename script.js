const SUPABASE_URL = "https://wblvohrnsubeemtzvlws.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7Ulaamw-CpI2WsP7r6P9ew_-H69fD0b";

const supabaseClient = window.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let usuarioLogado = null;
let perfilLogado = null;
let basesVisiveis = [];
let alunosVisiveis = [];
let lancamentosVisiveis = [];
let alunoSelecionadoNota = null;
let barChart = null;
let pieChart = null;
let carregandoSistema = false;

const isMobile = () => window.innerWidth <= 780;

function $(id) {
  return document.getElementById(id);
}

function mostrarErroLogin(msg) {
  const erroEl = $("loginErro");
  if (erroEl) erroEl.textContent = msg || "";
}

function mostrarAviso(msg) {
  window.alert(msg);
}

function usuarioEhAdmin() {
  return perfilLogado?.tipo_perfil === "admin_ases";
}

function getBaseIdsVisiveis() {
  return new Set((basesVisiveis || []).map((base) => Number(base.id)).filter(Boolean));
}

function filtrarPorBasesVisiveis(lista, campo = "base_id") {
  if (usuarioEhAdmin()) return lista || [];
  const baseIds = getBaseIdsVisiveis();
  return (lista || []).filter((item) => baseIds.has(Number(item?.[campo])));
}

function media(notas) {
  if (!notas || !notas.length) return 0;
  const soma = notas.reduce((acc, n) => acc + Number(n || 0), 0);
  return +(soma / notas.length).toFixed(1);
}

function classificarMedia(valor) {
  if (valor >= 8) return "Ótimo";
  if (valor >= 6) return "Regular";
  return "Atenção";
}

function formatarDataHora(iso) {
  const data = iso ? new Date(iso) : new Date();
  return {
    data: data.toLocaleDateString("pt-BR"),
    hora: data.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toggleMenu(forceOpen = null) {
  const sidebar = $("sidebar");
  const backdrop = $("mobileSidebarBackdrop");
  if (!sidebar) return;

  const abrir = forceOpen === null ? !sidebar.classList.contains("open") : Boolean(forceOpen);
  sidebar.classList.toggle("open", abrir);
  if (backdrop) backdrop.classList.toggle("show", abrir && isMobile());
  document.body.classList.toggle("menu-open", abrir && isMobile());
}

function fecharMenuMobile() {
  if (isMobile()) toggleMenu(false);
}

function trocarPagina(id, elemento) {
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  const pagina = $(id);
  if (pagina) pagina.classList.add("active");

  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  if (elemento) elemento.classList.add("active");

  fecharMenuMobile();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function atualizarEstadoConexao() {
  const chip = $("connectionBadge");
  if (!chip) return;
  chip.textContent = navigator.onLine ? "Online" : "Sem internet";
  chip.classList.toggle("offline", !navigator.onLine);
}

async function fazerLogin() {
  if (!supabaseClient) {
    mostrarErroLogin("Falha ao carregar bibliotecas do sistema. Recarregue a página.");
    return;
  }

  const email = $("loginEmail")?.value.trim() || "";
  const senha = $("loginSenha")?.value.trim() || "";

  mostrarErroLogin("");

  if (!email || !senha) {
    mostrarErroLogin("Preencha e-mail e senha.");
    return;
  }

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });

    if (error) {
      mostrarErroLogin(error.message || "Não foi possível entrar.");
      return;
    }

    usuarioLogado = data.user;
    await carregarSessaoCompleta();
    abrirSistema();
  } catch (e) {
    console.error(e);
    mostrarErroLogin(e.message || "Erro ao carregar dados do usuário.");
    await supabaseClient?.auth.signOut();
  }
}

async function carregarSessaoCompleta() {
  if (!usuarioLogado || !supabaseClient) return;

  const { data: perfil, error: perfilError } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", usuarioLogado.id)
    .single();

  if (perfilError) throw new Error("Não foi possível carregar o perfil do usuário.");

  perfilLogado = perfil;
  await carregarBasesVisiveis();
  await carregarDadosSistema();
}

async function carregarBasesVisiveis() {
  if (!supabaseClient) return;

  if (usuarioEhAdmin()) {
    const { data, error } = await supabaseClient
      .from("bases")
      .select("id, nome, codigo, cidade, status, igreja")
      .order("nome", { ascending: true });

    if (error) throw new Error("Erro ao carregar bases.");
    basesVisiveis = data || [];
    return;
  }

  const { data, error } = await supabaseClient
    .from("profile_bases")
    .select(`
      base_id,
      bases (
        id,
        nome,
        codigo,
        cidade,
        status,
        igreja
      )
    `)
    .eq("profile_id", usuarioLogado.id);

  if (error) throw new Error("Erro ao carregar bases do usuário.");

  basesVisiveis = (data || [])
    .map((item) => item.bases)
    .filter(Boolean)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

function setLoadingState(loading) {
  carregandoSistema = loading;
  document.body.classList.toggle("loading", loading);
  const layer = $("loadingOverlay");
  if (layer) layer.classList.toggle("show", loading);
}

async function carregarDadosSistema() {
  if (carregandoSistema) return;
  setLoadingState(true);

  try {
    await Promise.all([carregarAlunos(), carregarLancamentos()]);
    renderTudo();
  } finally {
    setLoadingState(false);
  }
}

async function carregarAlunos() {
  const { data, error } = await supabaseClient
    .from("alunos")
    .select(`
      id,
      nome,
      matricula,
      base_id,
      status,
      created_at,
      bases (
        id,
        nome,
        igreja
      )
    `)
    .order("nome", { ascending: true });

  if (error) throw new Error("Erro ao carregar alunos.");
  alunosVisiveis = filtrarPorBasesVisiveis(data || []);
}

async function carregarLancamentos() {
  const { data, error } = await supabaseClient
    .from("lancamentos_notas")
    .select(`
      id,
      aluno_id,
      base_id,
      semana,
      nota,
      observacao,
      created_at,
      lancado_por_profile_id,
      alunos (
        id,
        nome
      ),
      bases (
        id,
        nome,
        igreja
      ),
      profiles (
        id,
        nome
      )
    `)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) throw new Error("Erro ao carregar lançamentos.");
  lancamentosVisiveis = filtrarPorBasesVisiveis(data || []);
}

function abrirSistema() {
  setLoadingState(true);
  $("loginScreen")?.classList.add("hidden");
  $("appShell")?.classList.remove("hidden");
  $("usuarioInfo").textContent = `Responsável: ${perfilLogado?.nome || "-"}`;
  $("baseBadge").textContent = usuarioEhAdmin()
    ? "Acesso Geral - ASES"
    : (basesVisiveis[0]?.nome || "Sem base vinculada");

  preencherSelectBases();
  atualizarEstadoConexao();
  if (isMobile()) toggleMenu(false);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => setLoadingState(false));
  });
}

async function logout() {
  await supabaseClient?.auth.signOut();
  usuarioLogado = null;
  perfilLogado = null;
  basesVisiveis = [];
  alunosVisiveis = [];
  lancamentosVisiveis = [];

  $("loginScreen")?.classList.remove("hidden");
  $("appShell")?.classList.add("hidden");
  if ($("loginEmail")) $("loginEmail").value = "";
  if ($("loginSenha")) $("loginSenha").value = "";
  mostrarErroLogin("");
  toggleMenu(false);
}

function preencherSelectBases() {
  const select = $("novaBaseAluno");
  if (!select) return;

  select.innerHTML = "";

  basesVisiveis.forEach((base) => {
    const option = document.createElement("option");
    option.value = base.id;
    option.textContent = base.nome;
    select.appendChild(option);
  });
}

function getNotasPorAluno() {
  const mapa = new Map();

  alunosVisiveis.forEach((aluno) => mapa.set(aluno.id, []));

  lancamentosVisiveis.forEach((item) => {
    if (!mapa.has(item.aluno_id)) mapa.set(item.aluno_id, []);
    mapa.get(item.aluno_id).push(Number(item.nota));
  });

  return mapa;
}

function renderTudo() {
  renderResumo();
  renderRanking();
  renderAlunos();
  renderRelatorio();
  requestAnimationFrame(() => {
    renderGraficos();
  });
}

function destruirGraficos() {
  if (barChart) {
    barChart.destroy();
    barChart = null;
  }
  if (pieChart) {
    pieChart.destroy();
    pieChart = null;
  }
}

function renderGraficos() {
  const barCanvas = $("barChart");
  const pieCanvas = $("pieChart");
  if (!barCanvas || !pieCanvas || typeof Chart === "undefined") return;

  const notasPorAluno = getNotasPorAluno();
  const limite = isMobile() ? 8 : 20;

  const barras = alunosVisiveis
    .map((aluno) => ({
      nome: aluno.nome,
      media: media(notasPorAluno.get(aluno.id) || [])
    }))
    .sort((a, b) => b.media - a.media)
    .slice(0, limite);

  const pizzaDados = [
    { label: "Ótimo", valor: 0 },
    { label: "Regular", valor: 0 },
    { label: "Atenção", valor: 0 }
  ];

  alunosVisiveis.forEach((aluno) => {
    const categoria = classificarMedia(media(notasPorAluno.get(aluno.id) || []));
    const alvo = pizzaDados.find((p) => p.label === categoria);
    if (alvo) alvo.valor += 1;
  });

  destruirGraficos();
  barChart = new Chart(barCanvas, {
    type: "bar",
    data: {
      labels: barras.map((item) => item.nome),
      datasets: [
        {
          label: "Média do aluno",
          data: barras.map((item) => item.media),
          backgroundColor: "#1fb6e9",
          borderRadius: 16,
          borderSkipped: false,
          barThickness: isMobile() ? 38 : 58,
          maxBarThickness: isMobile() ? 44 : 64,
          categoryPercentage: 0.82,
          barPercentage: 0.9
        }
      ]
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true }
      },
      scales: {
        x: {
          ticks: {
            autoSkip: true,
            maxRotation: isMobile() ? 0 : 35,
            minRotation: 0
          }
        },
        y: {
          beginAtZero: true,
          max: 10,
          ticks: { stepSize: 1 }
        }
      }
    }
  });

  pieChart = new Chart(pieCanvas, {
    type: "pie",
    data: {
      labels: pizzaDados.map((item) => item.label),
      datasets: [
        {
          data: pizzaDados.map((item) => item.valor),
          backgroundColor: ["#1fb6e9", "#f4c400", "#8b5cf6"],
          borderWidth: 1,
          borderColor: "#ffffff"
        }
      ]
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } }
    }
  });
}

function renderRanking() {
  const lista = $("rankingList");
  if (!lista) return;

  const notasPorAluno = getNotasPorAluno();
  const ranking = alunosVisiveis
    .map((aluno) => ({
      nome: aluno.nome,
      base: aluno.bases?.nome || "",
      media: media(notasPorAluno.get(aluno.id) || [])
    }))
    .sort((a, b) => b.media - a.media);

  lista.innerHTML = "";
  lista.style.display = "block";
  lista.style.overflowY = "auto";
  lista.style.overflowX = "hidden";
  lista.style.height = window.innerWidth <= 780 ? "300px" : "420px";
  lista.style.maxHeight = window.innerWidth <= 780 ? "300px" : "420px";

  if (!ranking.length) {
    lista.innerHTML = '<li class="empty-state">Nenhum aluno cadastrado.</li>';
    return;
  }

  ranking.forEach((item) => {
    const li = document.createElement("li");
    li.className = "ranking-item";
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(item.nome)}</strong><br>
        <small>${escapeHtml(item.base)}</small>
      </div>
      <strong>${item.media.toFixed(1)}</strong>
    `;
    lista.appendChild(li);
  });
}

function renderResumo() {
  const notasPorAluno = getNotasPorAluno();
  const totalAlunos = alunosVisiveis.length;
  const totalLancamentos = lancamentosVisiveis.length;
  const medias = alunosVisiveis.map((aluno) => media(notasPorAluno.get(aluno.id) || []));
  const mediaBase = medias.length
    ? (medias.reduce((acc, valor) => acc + valor, 0) / medias.length).toFixed(1)
    : "0.0";

  $("totalAlunos").textContent = totalAlunos;
  $("totalLancamentos").textContent = totalLancamentos;
  $("mediaBase").textContent = mediaBase;
}

function renderAlunos() {
  const campoBusca = $("buscaAluno");
  const busca = (campoBusca?.value || "").toLowerCase().trim();
  const lista = $("listaAlunos");
  if (!lista) return;

  const notasPorAluno = getNotasPorAluno();
  const alunosFiltrados = alunosVisiveis.filter((aluno) =>
    (aluno.nome || "").toLowerCase().includes(busca)
  );

  lista.innerHTML = "";

  if (!alunosFiltrados.length) {
    lista.innerHTML = '<div class="card empty-state">Nenhum aluno encontrado.</div>';
    return;
  }

  alunosFiltrados.forEach((aluno) => {
    const notas = notasPorAluno.get(aluno.id) || [];
    const div = document.createElement("div");
    div.className = "student-row";
    div.innerHTML = `
      <div class="student-left">
        <div class="avatar">${escapeHtml((aluno.nome || "?").charAt(0).toUpperCase())}</div>
        <div>
          <div class="student-name">${escapeHtml(aluno.nome)}</div>
          <div class="student-meta">
            Base: ${escapeHtml(aluno.bases?.nome || "-")}<br>
            Igreja: ${escapeHtml(aluno.bases?.igreja || "-")}<br>
            Média: ${media(notas).toFixed(1)} | Quantidade de notas: ${notas.length}
          </div>
        </div>
      </div>
      <div class="student-actions">
        <button class="btn btn-primary" onclick="abrirModalNota(${Number(aluno.id)})">Adicionar nota</button>
      </div>
    `;
    lista.appendChild(div);
  });
}

function renderRelatorio() {
  const tbody = $("relatorioBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!lancamentosVisiveis.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum lançamento encontrado.</td></tr>';
    return;
  }

  lancamentosVisiveis.forEach((item) => {
    const info = formatarDataHora(item.created_at);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Aluno">${escapeHtml(item.alunos?.nome || "-")}</td>
      <td data-label="Semana">Semana ${item.semana ?? "-"}</td>
      <td data-label="Nota">${escapeHtml(item.nota)}</td>
      <td data-label="Data">${escapeHtml(info.data)}</td>
      <td data-label="Hora">${escapeHtml(info.hora)}</td>
      <td data-label="Quem lançou">${escapeHtml(item.profiles?.nome || "-")}</td>
      <td data-label="Base">${escapeHtml(item.bases?.nome || "-")}</td>
      <td data-label="Igreja">${escapeHtml(item.bases?.igreja || "-")}</td>
    `;
    tbody.appendChild(tr);
  });
}

function abrirModalAluno() {
  if ($("novoAlunoNome")) $("novoAlunoNome").value = "";
  const campoBaseAdmin = $("campoBaseAdmin");

  if (usuarioEhAdmin()) {
    campoBaseAdmin?.classList.remove("hidden");
  } else {
    campoBaseAdmin?.classList.add("hidden");
  }

  $("modalAluno")?.classList.add("show");
}

function fecharModalAluno() {
  $("modalAluno")?.classList.remove("show");
}

async function salvarAluno() {
  const nome = $("novoAlunoNome")?.value.trim() || "";

  if (!nome) {
    mostrarAviso("Digite o nome do aluno.");
    return;
  }

  const baseId = usuarioEhAdmin()
    ? Number($("novaBaseAluno")?.value)
    : Number(basesVisiveis[0]?.id);

  if (!baseId) {
    mostrarAviso("Nenhuma base disponível para este usuário.");
    return;
  }

  const { error } = await supabaseClient.from("alunos").insert({
    nome,
    base_id: baseId,
    status: "ativo"
  });

  if (error) {
    mostrarAviso(error.message || "Erro ao cadastrar aluno.");
    return;
  }

  fecharModalAluno();
  await carregarAlunos();
  renderTudo();
}

function abrirModalNota(alunoId) {
  alunoSelecionadoNota = alunosVisiveis.find((aluno) => Number(aluno.id) === Number(alunoId));
  if (!alunoSelecionadoNota) return;

  if ($("semanaInput")) $("semanaInput").value = "";
  if ($("notaInput")) $("notaInput").value = "";
  if ($("observacaoInput")) $("observacaoInput").value = "";
  if ($("modalNotaAluno")) {
    $("modalNotaAluno").textContent =
      `Aluno: ${alunoSelecionadoNota.nome} | Base: ${alunoSelecionadoNota.bases?.nome || "-"} | Igreja: ${alunoSelecionadoNota.bases?.igreja || "-"}`;
  }

  if ($("baseNotaInput")) $("baseNotaInput").value = alunoSelecionadoNota.bases?.nome || "";
  if ($("igrejaNotaInput")) $("igrejaNotaInput").value = alunoSelecionadoNota.bases?.igreja || "";

  $("modalNota")?.classList.add("show");
}

function fecharModalNota() {
  alunoSelecionadoNota = null;
  $("modalNota")?.classList.remove("show");
}

async function salvarNota() {
  const semana = Number($("semanaInput")?.value);
  const valor = parseFloat($("notaInput")?.value);
  const observacao = $("observacaoInput")?.value.trim() || "";

  if (!alunoSelecionadoNota) {
    mostrarAviso("Aluno não selecionado.");
    return;
  }

  if (!semana || semana < 1 || semana > 13) {
    mostrarAviso("Selecione uma semana entre 1 e 13.");
    return;
  }

  if (Number.isNaN(valor) || valor < 0 || valor > 10) {
    mostrarAviso("Digite uma nota válida entre 0 e 10.");
    return;
  }

  const { error } = await supabaseClient.from("lancamentos_notas").insert({
    aluno_id: alunoSelecionadoNota.id,
    base_id: alunoSelecionadoNota.base_id,
    semana,
    nota: valor,
    observacao: observacao || null,
    lancado_por_profile_id: usuarioLogado.id
  });

  if (error) {
    mostrarAviso(error.message || "Erro ao salvar nota.");
    return;
  }

  fecharModalNota();
  await carregarLancamentos();
  renderTudo();
}

function exportarExcel() {
  if (typeof XLSX === "undefined") {
    mostrarAviso("A biblioteca de exportação não foi carregada.");
    return;
  }

  const linhas = lancamentosVisiveis.map((item) => {
    const info = formatarDataHora(item.created_at);
    return {
      "Nome do aluno": item.alunos?.nome || "-",
      Semana: item.semana ?? "-",
      Nota: item.nota,
      Data: info.data,
      Hora: info.hora,
      "Quem lançou": item.profiles?.nome || "-",
      Base: item.bases?.nome || "-",
      Igreja: item.bases?.igreja || "-"
    };
  });

  if (!linhas.length) {
    mostrarAviso("Não há lançamentos para exportar.");
    return;
  }

  const planilha = XLSX.utils.json_to_sheet(linhas);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, "Relatório");
  XLSX.writeFile(workbook, "relatorio_notas.xlsx");
}

window.addEventListener("click", (event) => {
  const modalAluno = $("modalAluno");
  const modalNota = $("modalNota");

  if (event.target === modalAluno) fecharModalAluno();
  if (event.target === modalNota) fecharModalNota();
});

window.addEventListener("online", atualizarEstadoConexao);
window.addEventListener("offline", atualizarEstadoConexao);

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!isMobile()) {
      toggleMenu(true);
    } else {
      toggleMenu(false);
    }
    renderGraficos();
  }, 150);
});

window.addEventListener("DOMContentLoaded", async () => {
  atualizarEstadoConexao();

  if (!window.supabase || !window.Chart || !window.XLSX) {
    mostrarErroLogin("Alguns recursos não carregaram. Verifique sua conexão e recarregue a página.");
    return;
  }

  if (isMobile()) toggleMenu(false);

  document.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("focus", () => {
      setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
    });
  });

  const { data } = await supabaseClient.auth.getSession();

  if (data.session?.user) {
    try {
      usuarioLogado = data.session.user;
      await carregarSessaoCompleta();
      abrirSistema();
    } catch (error) {
      console.error(error);
      await supabaseClient.auth.signOut();
    }
  }
});
