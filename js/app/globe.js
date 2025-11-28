/**
 * Visualizacion 3D de viajes de equipos argentinos.
 * Estilo minimalista con pins y arcos animados.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ESTADIOS } from '../data/estadios.js';

// Detectar entorno
const isGitHubPages = window.location.hostname.includes('github.io');

// Configuracion
const CONFIG = {
    globeRadius: 1,
    arcHeight: 0.15,
    pinHeight: 0.012,
    pinRadius: 0.0015,
    planeSize: 0.008,
    arcSegments: 100,
    arcAnimationDuration: 1200,
    delayBetweenArcs: 200,
    argentinaCenter: { lat: -34.5, lon: -64.0 }
};

let scene, camera, renderer, controls;
let viajesData = [];
let currentViaje = 0;

// Control de animacion
let isPaused = false;
let currentAnimationId = null;
let currentVehicle = null;
let pendingTimeout = null;

// Estadisticas por tipo de partido
const stats = {
    local: { g: 0, e: 0, p: 0 },
    avion: { g: 0, e: 0, p: 0, km: 0 },
    bus: { g: 0, e: 0, p: 0, km: 0 }
};

// Convertir lat/lon a posicion 3D
function latLonToVector3(lat, lon, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return new THREE.Vector3(
        -radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
    );
}

// Crear pin minimalista (linea vertical + punto)
function createPin(lat, lon, color, isHome = false) {
    const group = new THREE.Group();
    const basePos = latLonToVector3(lat, lon, CONFIG.globeRadius);
    const topPos = latLonToVector3(lat, lon, CONFIG.globeRadius + CONFIG.pinHeight);

    // Linea del pin
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([basePos, topPos]);
    const lineMaterial = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: isHome ? 1 : 0.6
    });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    group.add(line);

    // Punto superior del pin
    const dotGeometry = new THREE.SphereGeometry(isHome ? CONFIG.pinRadius * 1.5 : CONFIG.pinRadius, 8, 8);
    const dotMaterial = new THREE.MeshBasicMaterial({ color: color });
    const dot = new THREE.Mesh(dotGeometry, dotMaterial);
    dot.position.copy(topPos);
    group.add(dot);

    return group;
}

// Color segun tipo de viaje y resultado
// Ida: gris | Vuelta: verde (victoria), amarillo (empate), rojo (derrota)
function getColorByViaje(viaje) {
    if (viaje.tipo === 'ida') {
        return 0x888888; // gris
    }
    // Vuelta: color segun resultado
    if (viaje.resultado === 'victoria') return 0x00cc66; // verde
    if (viaje.resultado === 'empate') return 0xffcc00;   // amarillo
    return 0xff3333; // rojo (derrota)
}

// Texturas del vehiculo (cargadas una vez)
let planeTexture = null;
let busTexture = null;
const textureLoader = new THREE.TextureLoader();
const imgPath = isGitHubPages ? 'img/' : '/img/';
textureLoader.load(imgPath + 'avion.jpeg', (texture) => {
    planeTexture = texture;
});
textureLoader.load(imgPath + 'bus-icon-vector.jpg', (texture) => {
    busTexture = texture;
});

// Crear vehiculo (sprite con imagen: bus < 200km, avion >= 200km)
function createVehicle(color, distanciaKm) {
    const texture = distanciaKm < 200 ? busTexture : planeTexture;
    const material = new THREE.SpriteMaterial({
        map: texture,
        color: color,
        sizeAttenuation: true,
        transparent: true
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(CONFIG.planeSize * 2, CONFIG.planeSize * 2, 1);

    return sprite;
}

// Crear arco con animacion progresiva y vehiculo
function createAnimatedArc(start, end, color, distanciaKm, onComplete) {
    const startVec = latLonToVector3(start.lat, start.lon, CONFIG.globeRadius + CONFIG.pinHeight);
    const endVec = latLonToVector3(end.lat, end.lon, CONFIG.globeRadius + CONFIG.pinHeight);

    // Punto medio elevado (arco mas pronunciado)
    const mid = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
    const distance = startVec.distanceTo(endVec);
    mid.normalize().multiplyScalar(CONFIG.globeRadius + CONFIG.arcHeight + CONFIG.arcHeight * distance * 0.5);

    // Curva completa
    const curve = new THREE.QuadraticBezierCurve3(startVec, mid, endVec);
    const allPoints = curve.getPoints(CONFIG.arcSegments);

    // Geometria del arco
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((CONFIG.arcSegments + 1) * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.7
    });

    const line = new THREE.Line(geometry, material);
    scene.add(line);

    // Crear vehiculo (bus o avion segun distancia)
    const vehicle = createVehicle(color, distanciaKm);
    scene.add(vehicle);
    currentVehicle = vehicle;

    // Animacion progresiva
    const startTime = Date.now();
    let pausedTime = 0;

    function animateArc() {
        if (isPaused) {
            pausedTime = Date.now() - startTime;
            currentAnimationId = requestAnimationFrame(animateArc);
            return;
        }

        const elapsed = Date.now() - startTime - pausedTime;
        const progress = Math.min(elapsed / CONFIG.arcAnimationDuration, 1);

        // Actualizar puntos visibles del arco
        const visibleCount = Math.floor(progress * CONFIG.arcSegments);
        const posArray = line.geometry.attributes.position.array;

        for (let i = 0; i <= visibleCount && i < allPoints.length; i++) {
            posArray[i * 3] = allPoints[i].x;
            posArray[i * 3 + 1] = allPoints[i].y;
            posArray[i * 3 + 2] = allPoints[i].z;
        }

        line.geometry.setDrawRange(0, visibleCount + 1);
        line.geometry.attributes.position.needsUpdate = true;

        // Posicionar vehiculo en el frente del arco
        if (visibleCount > 0 && visibleCount < allPoints.length) {
            const currentPos = allPoints[visibleCount];
            vehicle.position.copy(currentPos);
        }

        if (progress < 1) {
            currentAnimationId = requestAnimationFrame(animateArc);
        } else {
            // Ocultar vehiculo al terminar
            scene.remove(vehicle);
            currentVehicle = null;
            currentAnimationId = null;
            if (onComplete) onComplete();
        }
    }

    currentAnimationId = requestAnimationFrame(animateArc);
    return line;
}

// Inicializar escena
function initScene() {
    const container = document.getElementById('globe-container');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0.5, 2.5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1.2;
    controls.maxDistance = 3;
    controls.zoomSpeed = 0.5;
    controls.rotateSpeed = 0.5;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 3, 5);
    scene.add(directionalLight);

    createGlobe();
    window.addEventListener('resize', onWindowResize);
}

// Crear globo
function createGlobe() {
    const geometry = new THREE.SphereGeometry(CONFIG.globeRadius, 64, 64);
    const textureLoader = new THREE.TextureLoader();

    textureLoader.load(
        'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
        (texture) => {
            const material = new THREE.MeshPhongMaterial({ map: texture });
            const globe = new THREE.Mesh(geometry, material);
            scene.add(globe);
            positionCameraOnArgentina();
        },
        undefined,
        () => {
            const material = new THREE.MeshPhongMaterial({ color: 0x1a4d7c });
            const globe = new THREE.Mesh(geometry, material);
            scene.add(globe);
            positionCameraOnArgentina();
        }
    );
}

// Posicionar camara sobre Argentina
function positionCameraOnArgentina() {
    const target = latLonToVector3(CONFIG.argentinaCenter.lat, CONFIG.argentinaCenter.lon, 0);
    controls.target.copy(target.multiplyScalar(0.3));

    const cameraPos = latLonToVector3(
        CONFIG.argentinaCenter.lat + 5,
        CONFIG.argentinaCenter.lon + 20,
        2.2
    );
    camera.position.copy(cameraPos);
}

// Agregar pins de estadios
function addEstadiosPins(equipoCodigo) {
    // Pin del equipo local (verde brillante)
    const equipo = ESTADIOS[equipoCodigo];
    const homePin = createPin(equipo.lat, equipo.lon, 0x00ff99, true);
    scene.add(homePin);

    // Pins de otros estadios (gris tenue)
    Object.entries(ESTADIOS).forEach(([codigo, datos]) => {
        if (codigo !== equipoCodigo) {
            const pin = createPin(datos.lat, datos.lon, 0x666666, false);
            scene.add(pin);
        }
    });
}

// Animar viaje
function animateViaje(viaje, onComplete) {
    const desde = ESTADIOS[viaje.desde];
    const hacia = ESTADIOS[viaje.hacia];
    const color = getColorByViaje(viaje);

    // Actualizar UI
    updateViajeInfo(viaje);

    // Crear arco animado
    createAnimatedArc(
        { lat: desde.lat, lon: desde.lon },
        { lat: hacia.lat, lon: hacia.lon },
        color,
        viaje.distanciaKm,
        () => {
            // Agregar a tabla al llegar a destino en la ida
            if (viaje.tipo === 'ida') {
                addPartidoToTable(viaje);
            }
            setTimeout(onComplete, CONFIG.delayBetweenArcs);
        }
    );
}

// Actualizar panel de info
function updateViajeInfo(viaje) {
    // Mostrar siempre el rival (en ida es hacia, en vuelta es desde)
    const rival = viaje.tipo === 'ida' ? ESTADIOS[viaje.hacia] : ESTADIOS[viaje.desde];
    document.getElementById('viaje-info').style.display = 'block';
    document.getElementById('viaje-destino').textContent = `Viaje a ${rival.nombreCorto}`;
    document.getElementById('viaje-distancia').textContent =
        `${viaje.distanciaKm.toLocaleString('es-AR')} km`;
    document.getElementById('viaje-fecha').textContent =
        `Fecha ${viaje.fechaNum} - ${viaje.fecha}`;
}

// Actualizar panel para partido de local
function updateLocalInfo(evento) {
    const rival = ESTADIOS[evento.rival];
    document.getElementById('viaje-info').style.display = 'block';
    document.getElementById('viaje-destino').textContent =
        `Local vs ${rival.nombreCorto}`;
    document.getElementById('viaje-distancia').textContent = '0 km';
    document.getElementById('viaje-fecha').textContent =
        `Fecha ${evento.fechaNum} - ${evento.fecha}`;
}

// Actualizar tabla de estadisticas en el DOM
function updateStatsTable() {
    document.getElementById('local-g').textContent = stats.local.g;
    document.getElementById('local-e').textContent = stats.local.e;
    document.getElementById('local-p').textContent = stats.local.p;
    document.getElementById('avion-g').textContent = stats.avion.g;
    document.getElementById('avion-e').textContent = stats.avion.e;
    document.getElementById('avion-p').textContent = stats.avion.p;
    document.getElementById('avion-km').textContent = Math.round(stats.avion.km).toLocaleString('es-AR');
    document.getElementById('bus-g').textContent = stats.bus.g;
    document.getElementById('bus-e').textContent = stats.bus.e;
    document.getElementById('bus-p').textContent = stats.bus.p;
    document.getElementById('bus-km').textContent = Math.round(stats.bus.km).toLocaleString('es-AR');
}

// Resetear estadisticas
function resetStats() {
    stats.local = { g: 0, e: 0, p: 0 };
    stats.avion = { g: 0, e: 0, p: 0, km: 0 };
    stats.bus = { g: 0, e: 0, p: 0, km: 0 };
    updateStatsTable();
}

// Agregar estadistica segun tipo de partido
function addStat(evento, resultado) {
    const resKey = resultado === 'victoria' ? 'g' : resultado === 'empate' ? 'e' : 'p';

    if (evento.tipo === 'local') {
        stats.local[resKey]++;
    } else {
        // Visitante: avion >= 200km, bus < 200km
        // Distancia ida + vuelta
        const distanciaTotal = evento.distanciaKm * 2;
        if (evento.distanciaKm >= 200) {
            stats.avion[resKey]++;
            stats.avion.km += distanciaTotal;
        } else {
            stats.bus[resKey]++;
            stats.bus.km += distanciaTotal;
        }
    }
    updateStatsTable();
}

// Agregar partido a la tabla (ida o local)
function addPartidoToTable(evento) {
    // Solo agregar en ida o local
    if (evento.tipo !== 'ida' && evento.tipo !== 'local') return;

    const tbody = document.getElementById('partidos-body');
    let rival, resultado, vehiculoHtml;

    if (evento.tipo === 'local') {
        // Partido de local
        rival = ESTADIOS[evento.rival];
        resultado = evento.resultado;
        vehiculoHtml = '<span class="local-icon">L</span>';
    } else {
        // Viaje de ida (visitante)
        rival = ESTADIOS[evento.hacia];
        // Buscar resultado del viaje de vuelta correspondiente
        const viajeVuelta = viajesData.find(v =>
            v.tipo === 'vuelta' && v.fechaNum === evento.fechaNum && v.torneo === evento.torneo
        );
        resultado = viajeVuelta?.resultado || 'empate';
        const vehiculoImg = imgPath + (evento.distanciaKm >= 200 ? 'avion.jpeg' : 'bus-icon-vector.jpg');
        vehiculoHtml = `<img src="${vehiculoImg}" class="vehiculo-icon">`;
    }

    // Actualizar estadisticas
    addStat(evento, resultado);

    // Letra del resultado: G, E, P
    const resLetra = resultado === 'victoria' ? 'G' : resultado === 'empate' ? 'E' : 'P';

    const tr = document.createElement('tr');
    tr.className = resultado;
    tr.innerHTML = `
        <td>${evento.fecha}</td>
        <td>${evento.torneo}</td>
        <td>${evento.fechaNum}</td>
        <td>${rival.nombreCorto}</td>
        <td>${resLetra}</td>
        <td>${vehiculoHtml}</td>
    `;

    tbody.appendChild(tr);

    // Scroll al ultimo partido
    const container = document.querySelector('.partidos-table-container');
    container.scrollTop = container.scrollHeight;
}

// Loop de render
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// Resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Limpiar arcos del mapa
function clearArcs() {
    const toRemove = [];
    scene.traverse((obj) => {
        if (obj.type === 'Line' && obj.geometry?.attributes?.position?.count > 2) {
            toRemove.push(obj);
        }
        if (obj.type === 'Sprite') {
            toRemove.push(obj);
        }
    });
    toRemove.forEach(obj => scene.remove(obj));
    if (currentVehicle) {
        scene.remove(currentVehicle);
        currentVehicle = null;
    }
}

// Cancelar animacion en curso
function stopCurrentAnimation() {
    if (currentAnimationId) {
        cancelAnimationFrame(currentAnimationId);
        currentAnimationId = null;
    }
    if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        pendingTimeout = null;
    }
}

// Actualizar estado de botones
function updateControlButtons() {
    const btnPause = document.getElementById('btn-pause');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');

    if (!btnPause) return;

    btnPause.textContent = isPaused ? '▶' : '⏸';
    btnPause.title = isPaused ? 'Continuar' : 'Pausar';
    btnPrev.disabled = currentViaje <= 0;
    btnNext.disabled = currentViaje >= viajesData.length;
}

// Controles de animacion
function togglePause() {
    isPaused = !isPaused;
    updateControlButtons();
}

function goToStart() {
    stopCurrentAnimation();
    clearArcs();
    document.getElementById('partidos-body').innerHTML = '';
    resetStats();
    currentViaje = 0;
    isPaused = false;
    startViajesSequence();
}

function stepPrev() {
    if (currentViaje <= 0) return;
    stopCurrentAnimation();
    clearArcs();
    document.getElementById('partidos-body').innerHTML = '';
    resetStats();

    // Retroceder al viaje anterior
    currentViaje = Math.max(0, currentViaje - 1);

    // Re-dibujar todos los arcos hasta el viaje anterior
    const targetViaje = currentViaje;
    currentViaje = 0;
    isPaused = true;

    // Dibujar arcos estaticos hasta el punto anterior
    for (let i = 0; i < targetViaje; i++) {
        const evento = viajesData[i];
        if (evento.tipo !== 'local') {
            drawStaticArc(evento);
        }
        if (evento.tipo === 'ida' || evento.tipo === 'local') {
            addPartidoToTable(evento);
        }
    }

    currentViaje = targetViaje;
    updateControlButtons();

    // Mostrar info del viaje actual
    const evento = viajesData[currentViaje];
    if (evento) {
        if (evento.tipo === 'local') {
            updateLocalInfo(evento);
        } else {
            updateViajeInfo(evento);
        }
    }
}

function stepNext() {
    if (currentViaje >= viajesData.length) return;

    stopCurrentAnimation();
    const evento = viajesData[currentViaje];

    // Dibujar arco estatico del viaje actual
    if (evento.tipo !== 'local') {
        drawStaticArc(evento);
    }
    if (evento.tipo === 'ida' || evento.tipo === 'local') {
        addPartidoToTable(evento);
    }

    currentViaje++;
    isPaused = true;
    updateControlButtons();

    // Mostrar info del siguiente viaje
    if (currentViaje < viajesData.length) {
        const next = viajesData[currentViaje];
        if (next.tipo === 'local') {
            updateLocalInfo(next);
        } else {
            updateViajeInfo(next);
        }
    } else {
        document.getElementById('viaje-info').innerHTML =
            '<div class="label">Partidos completados</div>';
    }
}

function goToEnd() {
    stopCurrentAnimation();
    clearArcs();
    document.getElementById('partidos-body').innerHTML = '';
    resetStats();

    // Dibujar todos los arcos estaticos
    for (let i = 0; i < viajesData.length; i++) {
        const evento = viajesData[i];
        if (evento.tipo !== 'local') {
            drawStaticArc(evento);
        }
        if (evento.tipo === 'ida' || evento.tipo === 'local') {
            addPartidoToTable(evento);
        }
    }

    currentViaje = viajesData.length;
    isPaused = true;
    document.getElementById('viaje-info').innerHTML =
        '<div class="label">Partidos completados</div>';
    updateControlButtons();
}

// Dibujar arco estatico (sin animacion)
function drawStaticArc(viaje) {
    const desde = ESTADIOS[viaje.desde];
    const hacia = ESTADIOS[viaje.hacia];
    const color = getColorByViaje(viaje);

    const startVec = latLonToVector3(desde.lat, desde.lon, CONFIG.globeRadius + CONFIG.pinHeight);
    const endVec = latLonToVector3(hacia.lat, hacia.lon, CONFIG.globeRadius + CONFIG.pinHeight);

    const mid = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
    const distance = startVec.distanceTo(endVec);
    mid.normalize().multiplyScalar(CONFIG.globeRadius + CONFIG.arcHeight + CONFIG.arcHeight * distance * 0.5);

    const curve = new THREE.QuadraticBezierCurve3(startVec, mid, endVec);
    const points = curve.getPoints(CONFIG.arcSegments);

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.7
    });

    const line = new THREE.Line(geometry, material);
    scene.add(line);
}

// Inicializar controles
function initControls() {
    document.getElementById('btn-restart').addEventListener('click', goToStart);
    document.getElementById('btn-prev').addEventListener('click', stepPrev);
    document.getElementById('btn-pause').addEventListener('click', togglePause);
    document.getElementById('btn-next').addEventListener('click', stepNext);
    document.getElementById('btn-end').addEventListener('click', goToEnd);
}

// Secuencia de viajes
function startViajesSequence() {
    if (currentViaje >= viajesData.length) {
        document.getElementById('viaje-info').innerHTML =
            '<div class="label">Partidos completados</div>';
        updateControlButtons();
        return;
    }

    const evento = viajesData[currentViaje];
    updateControlButtons();

    if (evento.tipo === 'local') {
        // Partido de local: agregar a tabla y esperar 2s
        updateLocalInfo(evento);
        addPartidoToTable(evento);
        pendingTimeout = setTimeout(() => {
            pendingTimeout = null;
            currentViaje++;
            startViajesSequence();
        }, 2000);
    } else {
        // Viaje (ida o vuelta)
        animateViaje(evento, () => {
            currentViaje++;
            startViajesSequence();
        });
    }
}

// Funcion principal
function iniciarVisualizacion(equipoCodigo, viajes) {
    viajesData = viajes;

    const equipo = ESTADIOS[equipoCodigo];
    document.title = `Viajes - ${equipo.nombreCorto}`;
    document.getElementById('equipo-nombre').textContent = equipo.nombreCorto;
    document.getElementById('total-viajes').textContent = viajes.length;

    const distanciaTotal = viajes.reduce((sum, v) => sum + (v.distanciaKm || 0), 0);
    document.getElementById('distancia-total').textContent =
        `${distanciaTotal.toLocaleString('es-AR', { maximumFractionDigits: 0 })} km`;

    initScene();
    addEstadiosPins(equipoCodigo);
    initControls();
    animate();

    setTimeout(startViajesSequence, 1500);
}

// Inicializacion
document.addEventListener('DOMContentLoaded', () => {
    // Obtener codigo segun entorno
    let equipoCodigo;
    if (isGitHubPages) {
        const urlParams = new URLSearchParams(window.location.search);
        equipoCodigo = urlParams.get('codigo');
    } else {
        const pathParts = window.location.pathname.split('/');
        equipoCodigo = pathParts[pathParts.length - 1];
    }

    const jsonPath = isGitHubPages ? 'js/data/viajes.json' : '/js/data/viajes.json';
    fetch(jsonPath)
        .then(res => res.json())
        .then(viajes => {
            if (viajes[equipoCodigo]) {
                iniciarVisualizacion(equipoCodigo, viajes[equipoCodigo]);
            } else {
                document.getElementById('equipo-nombre').textContent = 'Equipo no encontrado';
            }
        })
        .catch(err => {
            console.error('Error:', err);
            document.getElementById('equipo-nombre').textContent = 'Error cargando datos';
        });
});
