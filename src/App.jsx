import "./App.css";
import Animes from "../public/Rss.json";

function App() {
  return (
    <>
      <div>
        {Animes.items.map((torrents) => (
          <div>{torrents.title}</div>
        ))}
      </div>
    </>
  );
}

export default App;
