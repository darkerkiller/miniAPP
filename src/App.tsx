import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

function ignoreError(e: unknown) {
  try {
    JSON.stringify(e)
  } catch {
    return
  }
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException) return e.name === 'AbortError'
  if (typeof e === 'object' && e && 'name' in e) {
    const n = (e as { name?: string }).name
    return n === 'AbortError'
  }
  return false
}

type City = {
  name: string
  country?: string
  latitude: number
  longitude: number
}

type GeocodingResponse = {
  results?: Array<{
    name: string
    country?: string
    latitude: number
    longitude: number
  }>
}

type WeatherData = {
  current?: {
    temperature: number
    windspeed: number
    winddirection: number
    time: string
  }
  hourly?: {
    time: string[]
    temperature_2m: number[]
    relativehumidity_2m: number[]
  }
}

const FAVORITES_KEY = 'miniapp:favorites'
const LAST_CITY_KEY = 'miniapp:lastCity'

function App() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<City[]>([])
  const [selectedCity, setSelectedCity] = useState<City | null>(null)
  const [favorites, setFavorites] = useState<City[]>([])
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingSuggest, setLoadingSuggest] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suggestAbortRef = useRef<AbortController | null>(null)
  const weatherAbortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    try {
      const favRaw = localStorage.getItem(FAVORITES_KEY)
      if (favRaw) setFavorites(JSON.parse(favRaw))
      const lastCityRaw = localStorage.getItem(LAST_CITY_KEY)
      if (lastCityRaw) {
        const city = JSON.parse(lastCityRaw) as City
        setSelectedCity(city)
      }
    } catch (e) {
      ignoreError(e)
    }
    return () => {
      suggestAbortRef.current?.abort()
      weatherAbortRef.current?.abort()
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!selectedCity) return
    fetchWeather(selectedCity)
  }, [selectedCity])

  const hasFavorited = useMemo(() => {
    if (!selectedCity) return false
    return favorites.some(
      (c) =>
        c.latitude === selectedCity.latitude &&
        c.longitude === selectedCity.longitude &&
        c.name === selectedCity.name
    )
  }, [favorites, selectedCity])

  function saveFavorites(next: City[]) {
    setFavorites(next)
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
    } catch (e) {
      ignoreError(e)
    }
  }

  function onQueryChange(v: string) {
    setQuery(v)
    setError(null)
    setSuggestions([])
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      fetchSuggestions(v)
    }, 300)
  }

  async function fetchSuggestions(name: string) {
    if (!name.trim()) {
      setSuggestions([])
      return
    }
    if (loadingSuggest) setLoadingSuggest(false)
    setLoadingSuggest(true)
    suggestAbortRef.current?.abort()
    const controller = new AbortController()
    suggestAbortRef.current = controller
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        name
      )}&count=6&language=zh&format=json`
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: GeocodingResponse = await res.json()
      const list: City[] =
        data.results?.map((r) => ({
          name: r.name,
          country: r.country,
          latitude: r.latitude,
          longitude: r.longitude,
        })) ?? []
      setSuggestions(list)
    } catch (e: unknown) {
      if (!isAbortError(e)) {
        setError('城市搜索失败，请稍后重试')
      }
    } finally {
      setLoadingSuggest(false)
    }
  }

  async function fetchWeather(city: City) {
    setWeather(null)
    setLoading(true)
    setError(null)
    weatherAbortRef.current?.abort()
    const controller = new AbortController()
    weatherAbortRef.current = controller
    try {
      const base = 'https://api.open-meteo.com/v1/forecast'
      const params = new URLSearchParams({
        latitude: String(city.latitude),
        longitude: String(city.longitude),
        current_weather: 'true',
        hourly: 'temperature_2m,relativehumidity_2m',
        timezone: 'auto',
      })
      const res = await fetch(`${base}?${params.toString()}`, {
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const current = data.current_weather
      const hourly = data.hourly
      const next24IdxEnd = Math.min(24, hourly.time.length)
      const hourlySlice = {
        time: hourly.time.slice(0, next24IdxEnd),
        temperature_2m: hourly.temperature_2m.slice(0, next24IdxEnd),
        relativehumidity_2m: hourly.relativehumidity_2m.slice(0, next24IdxEnd),
      }
      setWeather({
        current: {
          temperature: current.temperature,
          windspeed: current.windspeed,
          winddirection: current.winddirection,
          time: current.time,
        },
        hourly: hourlySlice,
      })
      try {
        localStorage.setItem(LAST_CITY_KEY, JSON.stringify(city))
      } catch (e) {
        ignoreError(e)
      }
    } catch (e: unknown) {
      if (!isAbortError(e)) {
        setError('天气数据获取失败，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }

  function selectCity(city: City) {
    setSelectedCity(city)
    setQuery(`${city.name}${city.country ? ` (${city.country})` : ''}`)
    setSuggestions([])
  }

  function toggleFavorite() {
    if (!selectedCity) return
    if (hasFavorited) {
      const next = favorites.filter(
        (c) =>
          !(
            c.latitude === selectedCity.latitude &&
            c.longitude === selectedCity.longitude &&
            c.name === selectedCity.name
          )
      )
      saveFavorites(next)
    } else {
      saveFavorites([selectedCity, ...favorites].slice(0, 20))
    }
  }

  return (
    <div>
      <h1>天气 Mini App</h1>
      <p className="subtitle">支持城市搜索、收藏，展示当前与小时天气</p>

      <div className="search">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="请输入城市名称，例如 北京 / Shanghai"
        />
        <button
          disabled={!selectedCity || loading}
          onClick={() => selectedCity && fetchWeather(selectedCity)}
        >
          查询
        </button>
      </div>

      {loadingSuggest && <div className="hint">正在搜索城市...</div>}
      {!!suggestions.length && (
        <ul className="suggestions">
          {suggestions.map((c) => (
            <li
              key={`${c.name}-${c.latitude}-${c.longitude}`}
              onClick={() => selectCity(c)}
              className="suggestion"
            >
              <span>{c.name}</span>
              <span className="muted">
                {c.country ?? ''} · {c.latitude.toFixed(2)},{' '}
                {c.longitude.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="favorites">
        <div className="favorites-header">
          <span>收藏城市</span>
          <button
            disabled={!selectedCity}
            onClick={toggleFavorite}
            className={hasFavorited ? 'fav active' : 'fav'}
            title={hasFavorited ? '取消收藏' : '添加到收藏'}
          >
            ★
          </button>
        </div>
        {!favorites.length ? (
          <div className="hint">暂无收藏，选择城市后可点击星标收藏</div>
        ) : (
          <div className="favorite-list">
            {favorites.map((c) => (
              <button
                key={`${c.name}-${c.latitude}-${c.longitude}`}
                className="favorite-item"
                onClick={() => selectCity(c)}
              >
                {c.name}
                {c.country ? ` · ${c.country}` : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="result">
        {selectedCity && (
          <div className="selected">
            <span>
              已选择：{selectedCity.name}
              {selectedCity.country ? `（${selectedCity.country}）` : ''}
            </span>
            <span className="muted">
              坐标：{selectedCity.latitude.toFixed(2)},{' '}
              {selectedCity.longitude.toFixed(2)}
            </span>
          </div>
        )}

        {loading && <div className="hint">正在加载天气数据...</div>}

        {weather && weather.current && (
          <div className="card">
            <h2>当前天气</h2>
            <div className="current">
              <div>
                温度：<b>{weather.current.temperature} ℃</b>
              </div>
              <div>风速：{weather.current.windspeed} m/s</div>
              <div>风向：{weather.current.winddirection} °</div>
              <div className="muted">时间：{weather.current.time}</div>
            </div>
          </div>
        )}

        {weather && weather.hourly && (
          <div className="card">
            <h2>未来24小时（每小时）</h2>
            <div className="hourly">
              {weather.hourly.time.map((t, i) => (
                <div key={t} className="hour-row">
                  <div className="hour-time">{t.slice(11)}</div>
                  <div className="hour-temp">
                    {weather.hourly!.temperature_2m[i]} ℃
                  </div>
                  <div className="hour-hum">
                    {weather.hourly!.relativehumidity_2m[i]} %
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
