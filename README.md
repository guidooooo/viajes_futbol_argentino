# Viajes del Futbol Argentino

Visualizacion 3D de los viajes de visitante de los 30 equipos de Primera Division Argentina 2025 solo para la fase de grupos

## Demo

Selector de equipos con kilometros totales por equipo. Click en un equipo para ver la animacion de sus viajes sobre un globo terraqueo.

## Funcionalidades

- Globo 3D interactivo con Three.js
- Animacion cronologica de viajes (ida y vuelta)
- Vehiculo segun distancia: bus (<200km) o avion (>=200km)
- Escudo del rival en el icono de transporte
- Colores segun resultado: verde (victoria), amarillo (empate), rojo (derrota)
- Tabla de partidos en tiempo real
- Estadisticas por tipo de partido (local, avion, bus)
- Controles de reproduccion (pausar, avanzar, retroceder)

## Instalacion

```bash
cd futbol-viajes-3d
node server.js
```

Abrir http://localhost:5050

## Estructura

```
public/
  index.html        # Selector de equipos
  equipo.html       # Vista 3D
  css/styles.css
  js/
    app/globe.js    # Motor Three.js
    data/
      estadios.js   # 30 equipos con coordenadas
      viajes.json   # Eventos ordenados
  img/
    escudos/        # 30 escudos
```

## Datos

- 30 equipos de Primera Division
- 480 partidos totales
- Distancias calculadas con formula Haversine
