const SUPABASE_URL = "https://wblvohrnsubeemtzvlws.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7Ulaamw-CpI2WsP7r6P9ew_-H69fD0b";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let usuarioLogado = null;
let perfilLogado = null;
let basesVisiveis = [];
let alunosVisiveis = [];
let lancamentosVisiveis = [];
let alunoSelecionadoNota = null;
let barChart = null;
let pieChart = null;

function usuarioEhAdmin() {
  return perfilLogado?.tipo_perfil === "admin_ases";
}

function media(notas) {
  if (!notas || !notas.length) return 0;
  const soma = notas.reduce((acc, n) => acc + Number(n), 0);
  return +(soma / notas.length).toFixed(1);
}

function classificarMedia(valor) {
  if (valor >= 8) return "Ótimo";
  if (valor >= 6) return "Regular";
  return "Atenção";
}

function formatarDataHora(iso) {
  const data = new Date(iso);
  return {
    data: data.toLocaleDateString("pt-BR"),
    hora: data.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  };
}

function toggleMenu() {
  document.getElementById("sidebar").classList.toggle("open");
}

function trocarPagina(id, elemento) {
  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  elemento.classList.add("active");
}

async function fazerLogin() {
  const email = document.getElementById("loginEmail").value.trim();
  const senha = document.getElementById("loginSenha").value.trim();
  const erroEl = document.getElementById("loginErro");

  erroEl.textContent = "";

  if (!email || !senha) {
    erroEl.textContent = "Preencha e-mail e senha.";
    return;
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password: senha
  });

  if (error) {
    erroEl.textContent = error.message || "Não foi possível entrar.";
    return;
  }

  usuarioLogado = data.user;

  try {
    await carregarSessaoCompleta();
    abrirSistema();
  } catch (e) {
    erroEl.textContent = e.message || "Erro ao carregar dados do usuário.";
    await supabaseClient.auth.signOut();
  }
}

async function carregarSessaoCompleta() {
  if (!usuarioLogado) return;

  const { data: perfil, error: perfilError } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", usuarioLogado.id)
    .single();

  if (perfilError) {
    throw new Error("Não foi possível carregar o perfil do usuário.");
  }

  perfilLogado = perfil;

  await carregarBasesVisiveis();
  await carregarDadosSistema();
}

async function carregarBasesVisiveis() {
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

async function carregarDadosSistema() {
  await Promise.all([carregarAlunos(), carregarLancamentos()]);
  renderTudo();
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
  alunosVisiveis = data || [];
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
    .order("created_at", { ascending: false });

  if (error) throw new Error("Erro ao carregar lançamentos.");
  lancamentosVisiveis = data || [];
}

function abrirSistema() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  document.getElementById("usuarioInfo").textContent = `Responsável: ${perfilLogado.nome}`;
  document.getElementById("baseBadge").textContent = usuarioEhAdmin()
    ? "Acesso Geral - ASES"
    : (basesVisiveis[0]?.nome || "Sem base vinculada");

  preencherSelectBases();
}

async function logout() {
  await supabaseClient.auth.signOut();
  usuarioLogado = null;
  perfilLogado = null;
  basesVisiveis = [];
  alunosVisiveis = [];
  lancamentosVisiveis = [];

  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("appShell").classList.add("hidden");
  document.getElementById("loginEmail").value = "";
  document.getElementById("loginSenha").value = "";
  document.getElementById("loginErro").textContent = "";
}

function preencherSelectBases() {
  const select = document.getElementById("novaBaseAluno");
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

  alunosVisiveis.forEach((aluno) => {
    mapa.set(aluno.id, []);
  });

  lancamentosVisiveis.forEach((item) => {
    if (!mapa.has(item.aluno_id)) mapa.set(item.aluno_id, []);
    mapa.get(item.aluno_id).push(Number(item.nota));
  });

  return mapa;
}

function renderTudo() {
  renderGraficos();
  renderRanking();
  renderResumo();
  renderAlunos();
  renderRelatorio();
}

function renderGraficos() {
  const notasPorAluno = getNotasPorAluno();

  const barras = alunosVisiveis
    .map((aluno) => ({
      nome: aluno.nome,
      media: media(notasPorAluno.get(aluno.id) || [])
    }))
    .sort((a, b) => b.media - a.media);

  const pizzaDados = [
    { label: "Ótimo", valor: 0 },
    { label: "Regular", valor: 0 },
    { label: "Atenção", valor: 0 }
  ];

  barras.forEach((item) => {
    const categoria = classificarMedia(item.media);
    const alvo = pizzaDados.find((p) => p.label === categoria);
    if (alvo) alvo.valor += 1;
  });

  if (barChart) barChart.destroy();
  if (pieChart) pieChart.destroy();

  barChart = new Chart(document.getElementById("barChart"), {
    type: "bar",
    data: {
      labels: barras.map((item) => item.nome),
      datasets: [
        {
          label: "Média do aluno",
          data: barras.map((item) => item.media),
          backgroundColor: "#1fb6e9",
          borderRadius: 24,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          max: 10,
          ticks: { stepSize: 1 }
        }
      }
    }
  });

  pieChart = new Chart(document.getElementById("pieChart"), {
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
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" }
      }
    }
  });
}

function renderRanking() {
  const lista = document.getElementById("rankingList");
  const notasPorAluno = getNotasPorAluno();

  const ranking = alunosVisiveis
    .map((aluno) => ({
      nome: aluno.nome,
      base: aluno.bases?.nome || "",
      media: media(notasPorAluno.get(aluno.id) || [])
    }))
    .sort((a, b) => b.media - a.media)
    .slice(0, 8);

  lista.innerHTML = "";

  if (!ranking.length) {
    lista.innerHTML = '<li class="empty-state">Nenhum aluno cadastrado.</li>';
    return;
  }

  ranking.forEach((item) => {
    const li = document.createElement("li");
    li.className = "ranking-item";
    li.innerHTML = `
      <div>
        <strong>${item.nome}</strong><br>
        <small>${item.base}</small>
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

  document.getElementById("totalAlunos").textContent = totalAlunos;
  document.getElementById("totalLancamentos").textContent = totalLancamentos;
  document.getElementById("mediaBase").textContent = mediaBase;
}

function renderAlunos() {
  const busca = document.getElementById("buscaAluno").value.toLowerCase().trim();
  const lista = document.getElementById("listaAlunos");
  const notasPorAluno = getNotasPorAluno();

  const alunosFiltrados = alunosVisiveis.filter((aluno) =>
    aluno.nome.toLowerCase().includes(busca)
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
        <div class="avatar">${aluno.nome.charAt(0).toUpperCase()}</div>
        <div>
          <div class="student-name">${aluno.nome}</div>
          <div class="student-meta">
            Base: ${aluno.bases?.nome || "-"} | Média: ${media(notas).toFixed(1)} | Quantidade de notas: ${notas.length}
          </div>
        </div>
      </div>
      <div class="student-actions">
        <button class="btn btn-primary" onclick="abrirModalNota(${aluno.id})">Adicionar nota</button>
      </div>
    `;
    lista.appendChild(div);
  });
}

function renderRelatorio() {
  const tbody = document.getElementById("relatorioBody");
  tbody.innerHTML = "";

  if (!lancamentosVisiveis.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum lançamento encontrado.</td></tr>';
    return;
  }

  lancamentosVisiveis.forEach((item) => {
    const info = formatarDataHora(item.created_at);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.alunos?.nome || "-"}</td>
      <td>Semana ${item.semana ?? "-"}</td>
      <td>${item.nota}</td>
      <td>${info.data}</td>
      <td>${info.hora}</td>
      <td>${item.profiles?.nome || "-"}</td>
      <td>${item.bases?.nome || "-"}</td>
      <td>${item.bases?.igreja || "-"}</td>
    `;
    tbody.appendChild(tr);
  });
}

function abrirModalAluno() {
  document.getElementById("novoAlunoNome").value = "";
  const campoBaseAdmin = document.getElementById("campoBaseAdmin");

  if (usuarioEhAdmin()) {
    campoBaseAdmin.classList.remove("hidden");
  } else {
    campoBaseAdmin.classList.add("hidden");
  }

  document.getElementById("modalAluno").classList.add("show");
}

function fecharModalAluno() {
  document.getElementById("modalAluno").classList.remove("show");
}

async function salvarAluno() {
  const nome = document.getElementById("novoAlunoNome").value.trim();

  if (!nome) {
    alert("Digite o nome do aluno.");
    return;
  }

  const baseId = usuarioEhAdmin()
    ? Number(document.getElementById("novaBaseAluno").value)
    : Number(basesVisiveis[0]?.id);

  if (!baseId) {
    alert("Nenhuma base disponível para este usuário.");
    return;
  }

  const { error } = await supabaseClient.from("alunos").insert({
    nome,
    base_id: baseId,
    status: "ativo"
  });

  if (error) {
    alert(error.message || "Erro ao cadastrar aluno.");
    return;
  }

  fecharModalAluno();
  await carregarAlunos();
  renderTudo();
}

function abrirModalNota(alunoId) {
  alunoSelecionadoNota = alunosVisiveis.find((aluno) => aluno.id === alunoId);
  if (!alunoSelecionadoNota) return;

  document.getElementById("semanaInput").value = "";
  document.getElementById("notaInput").value = "";
  document.getElementById("observacaoInput").value = "";
  document.getElementById("modalNotaAluno").textContent =
    `Aluno: ${alunoSelecionadoNota.nome} | Base: ${alunoSelecionadoNota.bases?.nome || "-"} | Igreja: ${alunoSelecionadoNota.bases?.igreja || "-"}`;

  document.getElementById("baseNotaInput").value =
    alunoSelecionadoNota.bases?.nome || "";

  document.getElementById("igrejaNotaInput").value =
    alunoSelecionadoNota.bases?.igreja || "";

  document.getElementById("modalNota").classList.add("show");
}

function fecharModalNota() {
  alunoSelecionadoNota = null;
  document.getElementById("modalNota").classList.remove("show");
}

async function salvarNota() {
  const semana = Number(document.getElementById("semanaInput").value);
  const valor = parseFloat(document.getElementById("notaInput").value);
  const observacao = document.getElementById("observacaoInput").value.trim();

  if (!alunoSelecionadoNota) {
    alert("Aluno não selecionado.");
    return;
  }

  if (!semana || semana < 1 || semana > 13) {
    alert("Selecione uma semana entre 1 e 13.");
    return;
  }

  if (Number.isNaN(valor) || valor < 0 || valor > 10) {
    alert("Digite uma nota válida entre 0 e 10.");
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
    alert(error.message || "Erro ao salvar nota.");
    return;
  }

  fecharModalNota();
  await carregarLancamentos();
  renderTudo();
}

function exportarExcel() {
  const linhas = lancamentosVisiveis.map((item) => {
    const info = formatarDataHora(item.created_at);
    return {
      "Nome do aluno": item.alunos?.nome || "-",
      "Semana": item.semana ?? "-",
      "Nota": item.nota,
      "Data": info.data,
      "Hora": info.hora,
      "Quem lançou": item.profiles?.nome || "-",
      "Base": item.bases?.nome || "-",
      "Igreja": item.bases?.igreja || "-"
    };
  });

  if (!linhas.length) {
    alert("Não há lançamentos para exportar.");
    return;
  }

  const planilha = XLSX.utils.json_to_sheet(linhas);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, "Relatório");
  XLSX.writeFile(workbook, "relatorio_notas.xlsx");
}

window.addEventListener("click", function (event) {
  const modalAluno = document.getElementById("modalAluno");
  const modalNota = document.getElementById("modalNota");

  if (event.target === modalAluno) fecharModalAluno();
  if (event.target === modalNota) fecharModalNota();
});

window.addEventListener("DOMContentLoaded", async () => {
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