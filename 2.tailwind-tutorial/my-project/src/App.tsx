export default function App() {
  return (
    <div className="min-h-screen   font-sans text-gray-900 antialiased">
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-4xl font-extrabold tracking-tight">
          我的第一个 <span className="text-blue-600">Tailwind</span> 页面
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-gray-600">
          这段文字使用了
          mt-4（上外边距）、text-lg（字号）、leading-relaxed（行高）和
          text-gray-600（颜色）四个工具类。
        </p>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row">
          <div className="flex-1 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl  ">卡片一</h2>
            <p className="mt-2 text-sm text-gray-500">
              移动端上下堆叠，sm 断点以上并排。
            </p>
          </div>
          <div className="flex-1 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl  ">卡片二</h2>
            <p className="mt-2 text-sm text-gray-500">
              试着拖动浏览器窗口宽度看布局变化。
            </p>
          </div>
        </div>

        <button
          type="button"
          className="mt-8 cursor-pointer rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white transition
                     hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-blue-600 active:bg-blue-800"
        >
          一个带完整交互状态的按钮
        </button>
      </main>
    </div>
  );
}
