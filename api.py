import os
import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

# --- 解决CORS跨域问题 ---
from fastapi.middleware.cors import CORSMiddleware

# --- 你原来的 LangChain 导入 (确保你已安装) ---
from langchain_community.agent_toolkits import create_sql_agent, SQLDatabaseToolkit
from langchain_community.utilities import SQLDatabase
from langchain_openai import ChatOpenAI
# (我们在这个API里不需要 get_openai_callback)

# --- 1. 数据库和LLM配置 (你原来的代码) ---
db_user = "root"
db_password = "123456"  # ⚠️ 确保这里是你本地的真实密码
db_host = "localhost:3306"
db_name = "认知智能"

try:
    db = SQLDatabase.from_uri(f"mysql+pymysql://{db_user}:{db_password}@{db_host}/{db_name}")
except Exception as e:
    print("!!!!!!!! 数据库连接失败! !!!!!!!!")
    print(f"错误: {e}")
    print("请确保你的MySQL正在运行，并且用户名密码正确。")
    # 如果启动时数据库连不上，程序也可以先运行
    db = None 

llm = ChatOpenAI(
    temperature=0.01,
    model="gpt-4o",  # 这个模型用于 '思考'，但你的中转站key是用于聊天的
    openai_api_base="https://api.rcouyi.com/v1/",
    openai_api_key='sk-EcBFjZVTzIJGqOaL5a1fB02494Fc4dEf93F791B4Dc1c2f75'
)

# --- 2. 创建 Agent (你原来的代码) ---
# 我们把 agent_executor 的创建放到一个函数里，以便在数据库连接失败时处理
def get_agent_executor():
    if db is None:
        raise Exception("数据库未连接，无法创建 SQL Agent")

    toolkit = SQLDatabaseToolkit(db=db, llm=llm)
    return create_sql_agent(
        llm=llm,
        toolkit=toolkit,
        verbose=True,
        handle_parsing_errors=True,
        return_intermediate_steps=True,  # 确保这里是 True (你原来就是)
        max_execution_time=30,
        max_iterations=15
    )

# --- 3. 创建 FastAPI 应用 ---
app = FastAPI()

# --- 4. 添加CORS中间件 (非常重要!) ---
# 这允许你的前端(http://localhost:3000)调用这个后端(http://localhost:8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # 允许你的Next.js前端
    allow_credentials=True,
    allow_methods=["*"],  # 允许所有HTTP方法
    allow_headers=["*"],  # 允许所有HTTP请求头
)

# --- 5. 定义请求体模型 ---
class QueryRequest(BaseModel):
    query: str

# --- 6. 创建 API 路由 (Endpoint) ---
@app.post("/query-sql")
async def handle_sql_query(request: QueryRequest):
    try:
        agent_executor = get_agent_executor()

        # 1. Agent 正常执行 (它会收到来自前端的 "...并告诉我SQL" 的提示)
        # 注意：LangChain 的 agent.invoke 是同步的
        # 我们用 agent.ainvoke 来异步执行它
        result = await agent_executor.ainvoke({"input": request.query})

        # 2. (核心修改) 我们主动从中间步骤提取SQL，确保结果更可靠
        sql_query = "未在中间步骤中找到 SQL 查询。" # 默认提示
        try:
            # 检查 intermediate_steps 是否存在且不为空
            if "intermediate_steps" in result and len(result["intermediate_steps"]) > 0:
                # 遍历所有步骤，查找第一个 "sql_db_query"
                for step in result["intermediate_steps"]:
                    action = step[0] # step[0] 是 AgentAction
                    if action.tool == "sql_db_query":
                        sql_query = action.tool_input
                        break # 找到第一个就停止
        except Exception as e:
            sql_query = f"提取 SQL 时出错: {str(e)}"

        # 3. 组合最终的输出 (自然语言回答 + 提取的SQL)
        final_output = f"{result['output']}\n\n**执行的 SQL:**\n```sql\n{sql_query}\n```"
        
        # 4. 返回组合后的结果
        return {"result": final_output}

    except Exception as e:
        # 如果出错，返回 500 错误和错误信息
        return {"error": str(e)}, 500

# --- 7. 启动服务器 ---
if __name__ == "__main__":
    print("启动 FastAPI 服务器，监听 http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)