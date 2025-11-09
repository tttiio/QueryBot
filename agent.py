import os
from langchain.agents import create_sql_agent
from langchain.agents.agent_toolkits import SQLDatabaseToolkit
from langchain.sql_database import SQLDatabase
from langchain.llms.openai import OpenAI
from langchain.agents import AgentExecutor
from langchain.chat_models import ChatOpenAI
from langchain.callbacks import get_openai_callback
import pandas as pd

# 数据库连接配置
db_user = "root"
db_password = "123456"  
db_host = "localhost:3306"    
db_name = "认知智能"  
db = SQLDatabase.from_uri(f"mysql+pymysql://{db_user}:{db_password}@{db_host}/{db_name}")

#api_key = os.getenv('DASHSCOPE_API_KEY')

llm = ChatOpenAI(
    temperature=0.01,
    model="gpt-4o",  #改模型
    openai_api_base="https://api.rcouyi.com/v1/",
    openai_api_key='sk-EcBFjZVTzIJGqOaL5a1fB02494Fc4dEf93F791B4Dc1c2f75'
)

toolkit = SQLDatabaseToolkit(db=db, llm=llm)

# 创建SQL智能体
agent_executor = create_sql_agent(
    llm=llm,
    toolkit=toolkit,
    verbose=True,
    handle_parsing_errors=True,
    return_intermediate_steps=True,
    max_execution_time=30,
    max_iterations=15
)

query = "列出联系电话（contact_no）以 '88019' 开头的客户信息，只需列出前10个结果。"

result = agent_executor.invoke({"input": query})
print(result["output"])